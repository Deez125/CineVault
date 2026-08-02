import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { stripe } from "@/lib/stripe/client";
import { applyEntitlement } from "@/lib/entitlements";
import { rewardForFirstPayment } from "@/lib/referrals";
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

      // A deleted subscription must not be judged as though it were live. Passing null makes
      // applyEntitlement look for another live one, which is right: cancelling a downgrade
      // attempt should not revoke someone who still has a good subscription.
      await applyEntitlement(user.id, {
        subscription: event.type === "customer.subscription.deleted" ? null : subscription,
        actor: "webhook",
      });
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
        await rewardForFirstPayment(user.id);
      }

      // Re-derive entitlement either way. A successful payment can move `past_due` back to
      // `active`, and a failed one eventually moves `active` to `past_due`; both change what
      // the member should have.
      await applyEntitlement(user.id, { actor: "webhook" });
      return;
    }
  }
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
