import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type User } from "@/lib/db/schema";
import { stripe, isEntitling } from "./client";
import { pickEntitling } from "@/lib/entitlements";

/**
 * Starting a subscription.
 *
 * The shape here is the one thing the previous billing setup existed to get right, so it is
 * worth stating plainly: **a member has at most one subscription, ever.** Changing tier is a
 * price swap on the existing one, prorated by Stripe. It is never a second checkout.
 *
 * That is not a style preference. The billing provider before Stripe had no upgrade path, so
 * "upgrading" meant buying a second subscription and being charged for both. Every function
 * in this file is written so that outcome is structurally impossible rather than merely
 * discouraged.
 */

export class AlreadySubscribedError extends Error {
  readonly code = "ALREADY_SUBSCRIBED";
  constructor(message: string) {
    super(message);
    this.name = "AlreadySubscribedError";
  }
}

export class BannedError extends Error {
  readonly code = "BANNED";
  constructor(message: string) {
    super(message);
    this.name = "BannedError";
  }
}

/**
 * The user's Stripe customer, created on first need.
 *
 * `metadata.userId` is set on the customer AND on the subscription, so a webhook can always
 * find its way back to a row here even if the customer id somehow never got written.
 */
export async function ensureCustomer(user: User): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name ?? undefined,
    metadata: { userId: user.id },
  });

  await db
    .update(users)
    .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  return customer.id;
}

export type CheckoutIntent = {
  clientSecret: string;
  subscriptionId: string;
};

/**
 * Create an incomplete subscription and hand back the secret the browser needs to confirm it.
 *
 * `payment_behavior: 'default_incomplete'` is the important part: the subscription exists but
 * **entitles nothing** until the card is actually confirmed. Access is granted later, by the
 * webhook, once Stripe says the money moved. Nothing on this path grants access, which is
 * what makes a failed or abandoned checkout harmless.
 */
export async function startCheckout(user: User, priceId: string): Promise<CheckoutIntent> {
  if (user.banned) {
    throw new BannedError("This account cannot start a subscription. Contact support.");
  }

  const customerId = await ensureCustomer(user);

  // Refuse to create a second subscription for someone who already has a live one. This is
  // the double-billing guard, and it checks STRIPE rather than our own is_member flag,
  // because our flag is a cache and the whole point is to be right even when it is stale.
  const existing = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 100,
  });

  const live = pickEntitling(existing.data);
  if (live && isEntitling(live.status)) {
    throw new AlreadySubscribedError(
      "You already have an active plan. Change it from the billing page instead of buying a second one."
    );
  }

  // Reuse an unpaid attempt at the SAME price rather than piling up abandoned subscriptions.
  // Someone who opens checkout, wanders off, and comes back tomorrow should not leave a trail
  // of `incomplete` subscriptions behind them.
  const reusable = existing.data.find(
    (s) => s.status === "incomplete" && s.items.data[0]?.price?.id === priceId
  );

  // Anything else left incomplete is an abandoned attempt at a DIFFERENT plan. Cancel it.
  //
  // Stripe expires these on its own after about a day, but a day is long enough for the
  // customer to come back, and leaving them around means the billing page has to keep
  // deciding which of several dead subscriptions to ignore. Better that there is only ever
  // one.
  for (const stale of existing.data) {
    if (stale.status !== "incomplete") continue;
    if (stale.id === reusable?.id) continue;

    try {
      await stripe.subscriptions.cancel(stale.id);
    } catch {
      // Already gone, or Stripe expired it first. Either way it is no longer in the way.
    }
  }

  const subscription =
    reusable ??
    (await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: "default_incomplete",
      // So the card they pay with becomes the card we renew with. Without this the
      // subscription has no default payment method and the SECOND invoice fails.
      payment_settings: { save_default_payment_method: "on_subscription" },
      // Deliberately NO payment_method_types. Stripe uses the account's payment method
      // configuration, which is where card / Apple Pay / Google Pay are managed. Hardcoding
      // a list here means an ineligible method breaks subscription creation outright.
      expand: ["latest_invoice.confirmation_secret"],
      metadata: { userId: user.id },
    }));

  const clientSecret = await confirmationSecretFor(subscription);

  if (!clientSecret) {
    // Fail loudly HERE. Handed nothing, Stripe's Payment Element can only render "Something
    // went wrong", and you get to debug a blank iframe instead of a message.
    throw new Error("Stripe returned no confirmation secret for this subscription");
  }

  return { clientSecret, subscriptionId: subscription.id };
}

/**
 * Dig the client secret out of a subscription's latest invoice.
 *
 * Re-fetches when the invoice came back unexpanded, which happens for a subscription we
 * reused rather than created.
 */
async function confirmationSecretFor(
  subscription: Stripe.Subscription
): Promise<string | null> {
  const fromExpanded = readSecret(subscription.latest_invoice);
  if (fromExpanded) return fromExpanded;

  const invoiceId =
    typeof subscription.latest_invoice === "string"
      ? subscription.latest_invoice
      : subscription.latest_invoice?.id;

  if (!invoiceId) return null;

  const invoice = await stripe.invoices.retrieve(invoiceId, {
    expand: ["confirmation_secret"],
  });

  return readSecret(invoice);
}

function readSecret(invoice: Stripe.Invoice | string | null | undefined): string | null {
  if (!invoice || typeof invoice === "string") return null;

  const secret = (invoice as { confirmation_secret?: { client_secret?: string } })
    .confirmation_secret;

  return secret?.client_secret ?? null;
}

/** What Stripe currently thinks of a subscription. Used to confirm a checkout really landed. */
export async function checkoutStatus(
  subscriptionId: string
): Promise<{ status: string; userId: string | null }> {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  return {
    status: subscription.status,
    userId: subscription.metadata?.userId ?? null,
  };
}
