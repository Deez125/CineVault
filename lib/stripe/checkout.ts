import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type User } from "@/lib/db/schema";
import { stripe, isEntitling } from "./client";
import { pickEntitling } from "@/lib/entitlements";
import { displayName } from "@/lib/display-name";
import { logError } from "@/lib/events";
import { REFEREE_PERCENT_OFF, REFERRAL_COUPON_ID, shouldDiscount } from "@/lib/referrals";

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
    name: displayName(user),
    metadata: { userId: user.id },
  });

  await db
    .update(users)
    .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  return customer.id;
}

/**
 * What the first invoice will come to, worked out BEFORE any subscription exists.
 *
 * Needed because of one specific case: when account credit covers the whole first month,
 * Stripe marks the invoice paid and the subscription `active` the instant it is created —
 * no card, no confirmation secret. Creating it on dialog-open would then subscribe somebody
 * and spend their credit merely because they clicked a plan to look at it.
 *
 * So the dialog asks this first and only creates a subscription when there is actually money
 * to collect. Computed locally rather than by previewing an invoice: the sums are ours (a
 * percentage coupon and a balance, no tax), it costs one customer read instead of a preview
 * call, and it is only ever used to decide whether a card is needed. Once a subscription does
 * exist, the real invoice is authoritative and these numbers are discarded.
 */
export type CheckoutQuote = {
  dueNow: number;
  recurring: number;
  discount: number;
  creditApplied: number;
  currency: string;
};

export async function quoteCheckout(user: User, priceId: string): Promise<CheckoutQuote> {
  const price = await stripe.prices.retrieve(priceId);
  const recurring = price.unit_amount ?? 0;
  const currency = price.currency;

  const discount = (await shouldDiscount(user.id))
    ? Math.round((recurring * REFEREE_PERCENT_OFF) / 100)
    : 0;

  let balance = 0;
  if (user.stripeCustomerId) {
    const customer = await stripe.customers.retrieve(user.stripeCustomerId);
    balance = customer.deleted ? 0 : Math.max(0, -customer.balance);
  }

  const afterDiscount = Math.max(0, recurring - discount);
  const creditApplied = Math.min(balance, afterDiscount);

  return {
    dueNow: Math.max(0, afterDiscount - creditApplied),
    recurring,
    discount,
    creditApplied,
    currency,
  };
}

export type CheckoutIntent = {
  /**
   * Null when there was nothing to charge — credit covered the whole first invoice, so Stripe
   * activated the subscription outright and there is no card step to perform.
   */
  clientSecret: string | null;
  subscriptionId: string;
  /**
   * What the card is actually charged today, after the referral coupon and any account
   * credit. Frequently NOT the plan price, and the button has to say so — quoting the sticker
   * price and then taking a different amount is the kind of surprise that ends in a
   * chargeback, even when the surprise is in the customer's favour.
   */
  dueNow: number;
  /** The plan's normal price — what it renews at once any first-month offer is spent. */
  recurring: number;
  /** Knocked off this first invoice by the referral coupon. */
  discount: number;
  /** Account credit consumed by this first invoice. */
  creditApplied: number;
  currency: string;
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
      ...(await referralDiscount(user)),
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

  // The invoice, resolved once and used for both the secret and the amounts. Re-fetched when
  // it came back unexpanded, which happens for a subscription we reused rather than created.
  const invoice = await resolveInvoice(subscription);
  const clientSecret = readSecret(invoice);

  // A missing secret is FINE in exactly one case: nothing was owed, so Stripe collected
  // nothing and made the subscription live on the spot. Anything else with no secret is a
  // real failure — handed nothing, Stripe's Payment Element can only render "Something went
  // wrong", and you get to debug a blank iframe instead of a message.
  if (!clientSecret && !isEntitling(subscription.status)) {
    throw new Error("Stripe returned no confirmation secret for this subscription");
  }

  const price = subscription.items.data[0]?.price;
  const recurring = price?.unit_amount ?? 0;

  return {
    clientSecret,
    subscriptionId: subscription.id,
    // Straight from the invoice rather than computed here. Stripe has already applied the
    // coupon and the balance in whatever order it applies them, and the only number worth
    // showing is the one it is going to take.
    dueNow: invoice?.amount_due ?? recurring,
    recurring,
    discount: invoice?.total_discount_amounts?.reduce((t, d) => t + d.amount, 0) ?? 0,
    creditApplied: Math.max(0, -(invoice?.starting_balance ?? 0)),
    currency: price?.currency ?? "usd",
  };
}

/**
 * The referred-friend discount, if this user has one coming.
 *
 * Returns something spreadable rather than a value, so the caller adds nothing at all when
 * there is no discount — Stripe treats `discounts: []` as "clear the discounts", which is not
 * the same as staying quiet.
 *
 * Every failure path here returns no discount rather than throwing. A missing coupon or a
 * Stripe hiccup should cost somebody 50% off, not stop them subscribing entirely; and the
 * referrer's own $10 is paid from the ledger later, so it survives regardless.
 */
async function referralDiscount(user: User): Promise<{ discounts?: [{ coupon: string }] }> {
  try {
    if (!(await shouldDiscount(user.id))) return {};

    // Confirm the coupon exists before naming it. An unknown coupon id makes Stripe reject
    // the whole subscription, which would turn "you have a discount" into "you cannot pay".
    await stripe.coupons.retrieve(REFERRAL_COUPON_ID);

    return { discounts: [{ coupon: REFERRAL_COUPON_ID }] };
  } catch (err) {
    await logError(
      "could not apply referral discount",
      { error: err instanceof Error ? err.message : String(err), coupon: REFERRAL_COUPON_ID },
      { userId: user.id, email: user.email, actor: "user" }
    );

    return {};
  }
}

/**
 * The subscription's first invoice, fully expanded.
 *
 * Re-fetches when it came back as an id or without its confirmation secret, which happens for
 * a subscription we reused rather than created. One call serves both the secret the browser
 * needs and the amounts the button has to quote — asking twice for the same object risks the
 * two disagreeing.
 */
async function resolveInvoice(
  subscription: Stripe.Subscription
): Promise<Stripe.Invoice | null> {
  const expanded =
    typeof subscription.latest_invoice === "string" ? null : subscription.latest_invoice;

  if (expanded && readSecret(expanded)) return expanded;

  const invoiceId =
    typeof subscription.latest_invoice === "string"
      ? subscription.latest_invoice
      : subscription.latest_invoice?.id;

  if (!invoiceId) return null;

  return stripe.invoices.retrieve(invoiceId, { expand: ["confirmation_secret"] });
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
