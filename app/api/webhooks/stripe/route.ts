import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { stripe } from "@/lib/stripe/client";
import { applyEntitlement } from "@/lib/entitlements";
import { restoreReward, reverseReward, rewardForFirstPayment } from "@/lib/referrals";
import { logError, logEvent } from "@/lib/events";

/**
 * Stripe's webhook.
 *
 * This is the endpoint that actually grants access. Everything the browser does during
 * checkout is preparation; the money becoming real happens here, out of band, and the
 * customer's browser is not involved and may already be closed.
 *
 * WHICH MEANS: if Stripe cannot reach this URL, **payments succeed and nothing happens.** The
 * card is charged, Stripe shows a healthy subscription, and the member is never provisioned.
 * A deployment can look completely fine in that state. Verify it by curling the real URL and
 * reading the body, not by trusting a green tick.
 *
 * Locally:
 *   stripe listen --forward-to localhost:3100/api/webhooks/stripe
 */

/** Events we act on. Everything else is acknowledged and ignored. */
const HANDLED = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  // Referral clawback. Nothing about ACCESS depends on these — a refund does not cancel a
  // subscription, and a dispute is handled by Stripe's own rules — but a referral credit paid
  // out on money that went back is a leak, and these are the only notice we get.
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed",
]);

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return Response.json({ error: "missing stripe-signature" }, { status: 400 });
  }

  if (!env.STRIPE_WEBHOOK_SECRET) {
    // Refuse rather than process unverified events. Anyone could otherwise POST a fabricated
    // "subscription active" here and hand themselves a paid account.
    await logError("Stripe webhook received but STRIPE_WEBHOOK_SECRET is not set", {});
    return Response.json({ error: "webhook not configured" }, { status: 500 });
  }

  // The RAW body. Signature verification is over the exact bytes Stripe sent, so parsing to
  // JSON first and re-serialising produces a different string and every event fails to
  // verify.
  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      payload,
      signature,
      env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    // A bad signature is either a misconfiguration or someone probing. Neither deserves a
    // detailed answer.
    console.error("[webhook] signature verification failed:", err instanceof Error ? err.message : err);
    return Response.json({ error: "invalid signature" }, { status: 400 });
  }

  if (!HANDLED.has(event.type)) {
    return Response.json({ received: true, ignored: event.type });
  }

  try {
    await handle(event);
  } catch (err) {
    // Return 500 so Stripe RETRIES. Swallowing the error with a 200 would mean a transient
    // database blip permanently loses somebody's access grant, and there would be no second
    // chance: Stripe considers a 2xx to mean "handled".
    await logError(
      `webhook ${event.type} failed`,
      { eventId: event.id, error: err instanceof Error ? err.message : String(err) },
      { actor: "webhook" }
    );
    return Response.json({ error: "handler failed" }, { status: 500 });
  }

  return Response.json({ received: true });
}

async function handle(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      const user = await findUser(subscription.customer, subscription.metadata?.userId);

      if (!user) {
        // Not an error worth retrying: a subscription in this Stripe account that does not
        // belong to anyone here (a test object, or a leftover from the previous system).
        console.warn(`[webhook] no user for subscription ${subscription.id}, ignoring`);
        return;
      }

      // DELIBERATELY does not pass `subscription`, so applyEntitlement re-reads from Stripe.
      //
      // The object inside an event is a snapshot of how things looked when it was emitted,
      // and **Stripe does not guarantee event ordering**. Checkout emits `created` with
      // status `incomplete` and `updated` with `active` moments apart; if they arrive the
      // other way round — which happens on retries, and on its own under load — judging by
      // the snapshot writes `incomplete` over a live subscription and revokes a paying
      // member. The reconciler heals it within five minutes, but five minutes is a stream
      // stopping mid-episode for no reason anybody can see.
      //
      // Re-reading costs one API call per event and makes ordering irrelevant: whatever
      // order they arrive in, every one of them asks Stripe what is true NOW and reaches the
      // same answer. It also covers `deleted` correctly, since pickEntitling looks for a
      // subscription that still entitles and finds none.
      await applyEntitlement(user.id, { actor: "webhook" });
      return;
    }

    case "invoice.payment_succeeded":
    case "invoice.payment_failed": {
      const invoice = event.data.object;
      const user = await findUser(invoice.customer, null);
      if (!user) return;

      if (event.type === "invoice.payment_failed") {
        await logEvent({
          type: "payment_failed",
          severity: "warn",
          actor: "webhook",
          userId: user.id,
          email: user.email,
          message: `payment failed for ${user.email}`,
          detail: {
            amount: invoice.amount_due,
            currency: invoice.currency,
            attempt: invoice.attempt_count,
          },
        });
      }

      if (event.type === "invoice.payment_succeeded" && invoice.amount_paid > 0) {
        // Pay whoever referred this member, if anybody did and this is their first payment.
        // Gated on `amount_paid > 0` so a $0 invoice — a full-coverage credit, a trial — does
        // not trigger a payout; and the ledger's own pending check makes a redelivered webhook
        // a no-op rather than a second $10.
        //
        // The invoice id goes with it so the reward records which payment earned it, which is
        // what a later refund matches on.
        await rewardForFirstPayment(user.id, invoice.id);
      }

      // Re-derive entitlement either way. A successful payment can move `past_due` back to
      // `active`, and a failed one eventually moves `active` to `past_due`; both change what
      // the member should have.
      await applyEntitlement(user.id, { actor: "webhook" });
      return;
    }

    case "charge.refunded": {
      const charge = event.data.object;

      // FULL refunds only. Refunding $3 of goodwill should not cost the person who introduced
      // them their $10 — they did pay, and they are still here.
      if (charge.amount_refunded < charge.amount) return;

      const intent = intentId(charge.payment_intent);
      if (intent) await reverseReward(intent, "refund");
      return;
    }

    case "charge.dispute.created": {
      // Stripe withdraws the money the moment a dispute opens, so the credit goes with it.
      // If the dispute is later won, `dispute.closed` below puts it back.
      const intent = intentId(event.data.object.payment_intent);
      if (intent) await reverseReward(intent, "dispute");
      return;
    }

    case "charge.dispute.closed": {
      const dispute = event.data.object;
      if (dispute.status !== "won") return;

      const intent = intentId(dispute.payment_intent);
      if (intent) await restoreReward(intent);
      return;
    }
  }
}

/** Stripe hands these back as either an id or the expanded object, depending on the event. */
function intentId(
  intent: string | Stripe.PaymentIntent | null | undefined
): string | null {
  if (!intent) return null;
  return typeof intent === "string" ? intent : intent.id;
}

/**
 * Find the user a Stripe object belongs to.
 *
 * Two routes, deliberately. The customer id is the normal one; `metadata.userId` is the
 * fallback for the window where a subscription exists but the customer id had not yet been
 * written to our row. Losing a grant because of that race would be silent and would look
 * exactly like the webhook never arriving.
 */
async function findUser(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
  metadataUserId: string | null | undefined
) {
  const customerId = typeof customer === "string" ? customer : customer?.id;

  if (customerId) {
    const [byCustomer] = await db
      .select()
      .from(users)
      .where(eq(users.stripeCustomerId, customerId))
      .limit(1);

    if (byCustomer) return byCustomer;
  }

  if (metadataUserId) {
    const [byMetadata] = await db
      .select()
      .from(users)
      .where(eq(users.id, metadataUserId))
      .limit(1);

    if (byMetadata) {
      // Heal the missing link so the next event takes the fast path.
      if (customerId && !byMetadata.stripeCustomerId) {
        await db
          .update(users)
          .set({ stripeCustomerId: customerId, updatedAt: new Date() })
          .where(eq(users.id, byMetadata.id));
      }
      return byMetadata;
    }
  }

  return null;
}
