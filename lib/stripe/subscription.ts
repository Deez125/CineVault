import type Stripe from "stripe";
import { stripe, isEntitling } from "./client";
import { streamsForPrice } from "./tiers";
import { pickEntitling } from "@/lib/entitlements";
import type { User } from "@/lib/db/schema";

/**
 * Reading and changing an existing subscription.
 *
 * Changing tier is a PRICE SWAP on the subscription the member already has, prorated by
 * Stripe. It is never a new subscription. See lib/stripe/checkout.ts for why that distinction
 * is the point of this whole design.
 */

export type PaymentMethodSummary = {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
};

export type InvoiceSummary = {
  id: string;
  created: string;
  amount: number;
  currency: string;
  status: string;
  url: string | null;
};

export type SubscriptionDetail = {
  id: string;
  status: string;
  priceId: string;
  streams: number;
  amount: number;
  currency: string;
  interval: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  paymentMethod: PaymentMethodSummary | null;
  invoices: InvoiceSummary[];
};

/**
 * The subscription that decides this member's access, with everything the UI needs.
 *
 * Returns null unless it actually ENTITLES something. That guard is load-bearing: an
 * abandoned checkout leaves an `incomplete` subscription on the customer, and pickEntitling
 * falls back to the most recent record when nothing is live — correct for the entitlement
 * engine, which then computes access as none, but wrong here, where the caller renders
 * whatever it gets as "your current plan".
 *
 * Without this, clicking a plan, landing on Stripe, and pressing back showed a fully
 * furnished Active plan with a renewal date for something nobody had paid for. Cancelling it
 * then failed, because the service layer correctly refused to cancel a subscription that
 * entitles nothing, and the two disagreed about reality.
 */
export async function getSubscriptionDetail(user: User): Promise<SubscriptionDetail | null> {
  if (!user.stripeCustomerId) return null;

  const list = await stripe.subscriptions.list({
    customer: user.stripeCustomerId,
    status: "all",
    limit: 100,
    expand: ["data.default_payment_method"],
  });

  const subscription = pickEntitling(list.data);
  if (!subscription || !isEntitling(subscription.status)) return null;

  const item = subscription.items.data[0];
  const price = item?.price;
  if (!price) return null;

  return {
    id: subscription.id,
    status: subscription.status,
    priceId: price.id,
    streams: await streamsForPrice(price.id),
    amount: price.unit_amount ?? 0,
    currency: price.currency,
    interval: price.recurring?.interval ?? "month",
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    currentPeriodEnd: periodEnd(subscription)?.toISOString() ?? null,
    paymentMethod: await resolvePaymentMethod(subscription, user.stripeCustomerId),
    invoices: await listInvoices(user.stripeCustomerId),
  };
}

export type ProrationPreview = {
  upgrading: boolean;
  /**
   * Net proration in minor units. POSITIVE means it is added to the next invoice, NEGATIVE
   * means it is a credit against it.
   *
   * Nothing is charged today. We use `create_prorations`, so Stripe records the adjustment as
   * pending invoice items and settles it on the next bill. That is deliberate: charging
   * immediately introduces a card decline at the exact moment someone is trying to give us
   * more money, and leaves the subscription half-changed when it fails.
   */
  prorationAmount: number;
  /** The new recurring price, from the next full period onward. */
  nextAmount: number;
  /** Roughly what the next invoice comes to: nextAmount + prorationAmount, never below zero. */
  nextBillTotal: number;
  nextBillDate: string | null;
  currency: string;
};

/**
 * What switching to `priceId` actually costs, before committing to it.
 *
 * Showing the real number first is the difference between an upgrade and a surprise charge,
 * and a surprise charge is a support ticket and a chargeback. Stripe's own billing portal
 * cannot do this, which is why plan changes live in our UI rather than there.
 */
export async function previewChange(user: User, priceId: string): Promise<ProrationPreview> {
  const subscription = await requireSubscription(user);
  const item = subscription.items.data[0];
  const currentAmount = item.price.unit_amount ?? 0;

  const target = await stripe.prices.retrieve(priceId);
  const targetAmount = target.unit_amount ?? 0;

  const preview = await stripe.invoices.createPreview({
    customer: user.stripeCustomerId!,
    subscription: subscription.id,
    subscription_details: {
      items: [{ id: item.id, price: priceId }],
      proration_behavior: "create_prorations",
    },
  });

  // ONLY the proration lines.
  //
  // A preview invoice for a mid-period switch contains three things: a credit for the unused
  // part of the old plan, a charge for the remaining part of the new one, and the next
  // period's full charge. Summing all three answers a different question entirely — measured
  // against the sandbox, a $30 to $40 switch came out as $49.99 instead of $9.99, because the
  // next period's $40 was being counted as though it were due now.
  //
  // The proration flag lives at parent.subscription_item_details.proration in current API
  // versions; the old top-level line.proration is gone.
  const prorationAmount = preview.lines.data
    .filter((line) => line.parent?.subscription_item_details?.proration === true)
    .reduce((total, line) => total + line.amount, 0);

  const upgrading = targetAmount > currentAmount;
  const nextBillDate = periodEnd(subscription);

  return {
    upgrading,
    prorationAmount,
    nextAmount: targetAmount,
    // Can't go below zero: a large credit reduces the invoice to nothing and rolls the
    // remainder forward, it never becomes a payment out to the customer.
    nextBillTotal: Math.max(0, targetAmount + prorationAmount),
    nextBillDate: nextBillDate?.toISOString() ?? null,
    currency: target.currency,
  };
}

/** Swap the price on the existing subscription, prorated. */
export async function changePlan(user: User, priceId: string): Promise<Stripe.Subscription> {
  const subscription = await requireSubscription(user);
  const item = subscription.items.data[0];

  if (item.price.id === priceId) return subscription;

  return stripe.subscriptions.update(subscription.id, {
    items: [{ id: item.id, price: priceId }],
    proration_behavior: "create_prorations",
    // Keep the metadata link intact; an update that dropped it would orphan the webhook's
    // fallback route back to this user.
    metadata: { userId: user.id },
  });
}

/**
 * Cancel at the END of the paid period, not now.
 *
 * They keep everything they already paid for until it runs out. Cancelling immediately would
 * mean taking a month's money and giving back three weeks of it in access, which is the kind
 * of thing people remember.
 */
export async function cancelPlan(user: User): Promise<Stripe.Subscription> {
  const subscription = await requireSubscription(user);
  return stripe.subscriptions.update(subscription.id, { cancel_at_period_end: true });
}

/** Undo a pending cancellation. */
export async function resumePlan(user: User): Promise<Stripe.Subscription> {
  const subscription = await requireSubscription(user);
  return stripe.subscriptions.update(subscription.id, { cancel_at_period_end: false });
}

/**
 * Cancel RIGHT NOW. Admin only.
 *
 * Removing the Plex share without cancelling would do nothing: the next reconcile sees a live
 * subscription and re-invites them within five minutes.
 */
export async function cancelImmediately(user: User): Promise<Stripe.Subscription | null> {
  if (!user.stripeSubscriptionId) return null;
  return stripe.subscriptions.cancel(user.stripeSubscriptionId);
}

/** Step one of a card change: a SetupIntent for the browser to confirm. */
export async function startCardUpdate(user: User): Promise<string> {
  if (!user.stripeCustomerId) throw new Error("no Stripe customer");

  const intent = await stripe.setupIntents.create({
    customer: user.stripeCustomerId,
    usage: "off_session",
    metadata: { userId: user.id },
  });

  if (!intent.client_secret) throw new Error("Stripe returned no client secret");
  return intent.client_secret;
}

/**
 * Step two: point the subscription at the new card.
 *
 * Both halves are required. Saving the card to the customer without setting it as the
 * subscription's default means the NEXT invoice still charges the old card, and the member
 * finds out through a failed payment email.
 */
export async function finishCardUpdate(user: User, paymentMethodId: string): Promise<void> {
  if (!user.stripeCustomerId) throw new Error("no Stripe customer");

  // Confirm the payment method really belongs to this customer before pointing anything at
  // it. The id arrives from the browser, and an id from somewhere else must not be attachable
  // to someone else's subscription.
  const method = await stripe.paymentMethods.retrieve(paymentMethodId);
  if (method.customer !== user.stripeCustomerId) {
    throw new Error("that payment method does not belong to this account");
  }

  await stripe.customers.update(user.stripeCustomerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });

  const subscription = await findSubscription(user);
  if (subscription) {
    await stripe.subscriptions.update(subscription.id, {
      default_payment_method: paymentMethodId,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════

async function findSubscription(user: User): Promise<Stripe.Subscription | null> {
  if (!user.stripeCustomerId) return null;

  const list = await stripe.subscriptions.list({
    customer: user.stripeCustomerId,
    status: "all",
    limit: 100,
  });

  return pickEntitling(list.data);
}

async function requireSubscription(user: User): Promise<Stripe.Subscription> {
  const subscription = await findSubscription(user);

  if (!subscription || !isEntitling(subscription.status)) {
    throw new NoSubscriptionError("You don't have an active plan to change.");
  }

  return subscription;
}

export class NoSubscriptionError extends Error {
  readonly code = "NO_SUBSCRIPTION";
  constructor(message: string) {
    super(message);
    this.name = "NoSubscriptionError";
  }
}

async function resolvePaymentMethod(
  subscription: Stripe.Subscription,
  customerId: string
): Promise<PaymentMethodSummary | null> {
  let method = subscription.default_payment_method;

  // Falls back to the customer's default. A subscription created before a card was attached
  // has none of its own, and reporting "no card on file" to someone who is being billed
  // successfully every month is simply wrong.
  if (!method) {
    const customer = await stripe.customers.retrieve(customerId, {
      expand: ["invoice_settings.default_payment_method"],
    });
    if (customer.deleted) return null;
    method = customer.invoice_settings?.default_payment_method ?? null;
  }

  if (!method || typeof method === "string") return null;
  if (!method.card) return null;

  return {
    brand: method.card.brand,
    last4: method.card.last4,
    expMonth: method.card.exp_month,
    expYear: method.card.exp_year,
  };
}

async function listInvoices(customerId: string): Promise<InvoiceSummary[]> {
  const invoices = await stripe.invoices.list({ customer: customerId, limit: 12 });

  return invoices.data
    .filter((invoice) => invoice.status !== "draft")
    .map((invoice) => ({
      id: invoice.id ?? "",
      created: new Date(invoice.created * 1000).toISOString(),
      amount: invoice.amount_paid || invoice.amount_due,
      currency: invoice.currency,
      status: invoice.status ?? "unknown",
      url: invoice.hosted_invoice_url ?? null,
    }));
}

/**
 * When the current paid period ends.
 *
 * Lives on the subscription ITEM in current API versions, having moved off the subscription
 * itself. Both are read, because a subscription created before the move still reports the old
 * shape and reading only one gives every member a renewal date of "Invalid Date".
 */
function periodEnd(subscription: Stripe.Subscription): Date | null {
  const seconds =
    subscription.items?.data[0]?.current_period_end ??
    (subscription as unknown as { current_period_end?: number }).current_period_end;

  return typeof seconds === "number" ? new Date(seconds * 1000) : null;
}
