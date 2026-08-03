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
  /**
   * Account credit sitting on the customer, as a POSITIVE number. Referral rewards land here.
   *
   * Worth surfacing on the billing page rather than only at checkout: somebody who has just
   * been told they earned $10 will go looking for it here, and a renewal line that still
   * quotes the full price reads as though the reward never happened.
   */
  creditBalance: number;
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

  // Stripe stores the balance as what the customer OWES, so a credit is negative. Flip it,
  // and treat "they owe us something" as no credit rather than as a negative one — that case
  // is settled on the invoice and is not this card's job to explain.
  const customer = await stripe.customers.retrieve(user.stripeCustomerId);
  const creditBalance = customer.deleted ? 0 : Math.max(0, -customer.balance);

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
    creditBalance,
    paymentMethod: await resolvePaymentMethod(subscription, user.stripeCustomerId),
    invoices: await listInvoices(user.stripeCustomerId),
  };
}

export type ProrationPreview = {
  upgrading: boolean;
  /**
   * What the card is charged the moment they confirm, after credit. Zero on a downgrade, and
   * zero when account credit covers the whole difference.
   */
  dueNow: number;
  /**
   * Credit ADDED to the account by this change, as a positive number. Downgrades produce
   * this: the unused part of the dearer plan, less the cost of the cheaper one for the rest
   * of the period.
   */
  creditBack: number;
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
  /**
   * Account credit that will come off the next invoice, as a POSITIVE number. Referral
   * rewards land here.
   *
   * Shown separately rather than folded silently into the total, because a credit somebody
   * earned is the last thing to hide from them — the referrals page promises $10 off, and
   * this is where they look to see it.
   */
  creditApplied: number;
  /** What the next invoice actually comes to, after proration AND credit. Never below zero. */
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
      // Must match what changePlan actually does, or the quote describes a different
      // transaction from the one the button performs.
      proration_behavior: "always_invoice",
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

  // Account credit, which the proration lines know nothing about.
  //
  // Stripe stores the balance as what the customer OWES, so a credit is negative. Without
  // this, somebody with a $10 referral reward is quoted $40 and charged $30 — the safe
  // direction to be wrong in, but still wrong, and it hides the reward at the one moment
  // they would go looking for it.
  //
  // `starting_balance` is what Stripe itself says it will apply to this invoice, which is
  // more trustworthy than reading customer.balance and reasoning about it separately.
  const balance = Math.max(0, -(preview.starting_balance ?? 0));

  // Upgrades charge; downgrades credit. Split them, because they are different sentences on
  // screen — "you pay this now" and "this goes on your account" — and conflating them into
  // one signed number is what made the old panel unreadable.
  const rawDue = prorationAmount > 0 ? prorationAmount : 0;
  const creditApplied = Math.min(balance, rawDue);
  const dueNow = Math.max(0, rawDue - creditApplied);
  const creditBack = prorationAmount < 0 ? -prorationAmount : 0;

  return {
    upgrading,
    dueNow,
    creditBack,
    prorationAmount,
    nextAmount: targetAmount,
    creditApplied,
    // The proration is settled TODAY now, so the next bill is simply the new plan price —
    // less whatever credit is still on the account afterwards. An upgrade spends some of the
    // balance; a downgrade adds to it.
    nextBillTotal: Math.max(0, targetAmount - (balance - creditApplied + creditBack)),
    nextBillDate: nextBillDate?.toISOString() ?? null,
    currency: target.currency,
  };
}

export type ChangeResult = {
  subscription: Stripe.Subscription;
  /**
   * Set when the bank wants the cardholder to confirm (3-D Secure). The plan has NOT changed
   * yet; it changes when this is confirmed in the browser and the invoice is paid.
   */
  clientSecret?: string;
};

/**
 * Switch plans, settling the difference NOW.
 *
 * `always_invoice` bills the proration immediately rather than parking it for the next
 * invoice. That is worth an API call and a decline path, because deferring it accumulates:
 * change plan twice in one period and the next bill carries FOUR proration lines, two of them
 * from a change made weeks ago. Measured on the sandbox, a $20→$30→$40 pair of upgrades
 * showed "+$19.97 rest of this month" when the second change alone was $9.98 — arithmetically
 * right, impossible to read, and impossible to explain to a customer.
 *
 * Settling as we go means each change costs exactly its own difference and nothing else, and
 * a downgrade hands back its credit there and then instead of vanishing into a future
 * invoice.
 *
 * `pending_if_incomplete` is what makes it safe. The subscription is NOT modified until the
 * money clears: a decline throws and leaves the old plan untouched, and a card needing
 * confirmation parks the change as a pending update that only applies once confirmed. There
 * is no state where somebody is moved to a plan they have not paid for.
 */
export async function changePlan(user: User, priceId: string): Promise<ChangeResult> {
  const subscription = await requireSubscription(user);
  const item = subscription.items.data[0];

  if (item.price.id === priceId) return { subscription };

  const updated = await stripe.subscriptions.update(subscription.id, {
    items: [{ id: item.id, price: priceId }],
    proration_behavior: "always_invoice",
    payment_behavior: "pending_if_incomplete",
    // Keep the metadata link intact; an update that dropped it would orphan the webhook's
    // fallback route back to this user.
    metadata: { userId: user.id },
    expand: ["latest_invoice.confirmation_secret"],
  });

  // No pending update means the invoice was paid outright and the plan has already changed.
  if (!updated.pending_update) return { subscription: updated };

  // A pending update means the money did not clear. Two very different reasons, and they need
  // opposite handling, so ask the PaymentIntent which one it is:
  //
  //   requires_action          — the bank wants the cardholder to confirm. Recoverable.
  //   requires_payment_method  — declined. Not recoverable with this card.
  //
  // Both leave the subscription on the OLD plan, which is the guarantee that matters. Both
  // also hand back a client secret, so the secret alone cannot tell them apart — sending a
  // declined card to the browser's confirmation flow produces "this PaymentIntent requires a
  // payment method", which tells the customer nothing about their card being refused.
  const invoice = typeof updated.latest_invoice === "string" ? null : updated.latest_invoice;
  const status = await paymentStatus(invoice);

  if (status?.state === "requires_action") {
    const secret = (invoice as { confirmation_secret?: { client_secret?: string } } | null)
      ?.confirmation_secret?.client_secret;

    if (secret) return { subscription: updated, clientSecret: secret };
  }

  // Declined, or something we cannot recover from. Void the invoice so the pending update
  // goes with it — otherwise it sits on the subscription for a day, and any later payment of
  // that invoice would silently apply a plan change nobody is expecting.
  if (invoice?.id) await stripe.invoices.voidInvoice(invoice.id).catch(() => {});

  throw new StripeCardDeclinedError(
    status?.code === "card_declined"
      ? "Your card was declined, so your plan hasn't changed. Try a different card."
      : "That payment didn't go through, so your plan hasn't changed."
  );
}

export class StripeCardDeclinedError extends Error {
  readonly code = "CARD_DECLINED";
  constructor(message: string) {
    super(message);
    this.name = "StripeCardDeclinedError";
  }
}

/** The PaymentIntent behind an invoice, and why it has not settled. */
async function paymentStatus(
  invoice: Stripe.Invoice | null
): Promise<{ state: string; code?: string } | null> {
  if (!invoice?.id) return null;

  try {
    const full = await stripe.invoices.retrieve(invoice.id, { expand: ["payments"] });
    const payment = full.payments?.data?.[0]?.payment;
    const intent = payment?.payment_intent;
    const id = typeof intent === "string" ? intent : intent?.id;
    if (!id) return null;

    const pi = await stripe.paymentIntents.retrieve(id);
    return { state: pi.status, code: pi.last_payment_error?.code };
  } catch {
    return null;
  }
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

/**
 * Terminate EVERY subscription on the customer, immediately.
 *
 * Deliberately not driven by `user.stripeSubscriptionId`. That column is a cache, and the
 * situations where you reach for this are exactly the ones where the cache is wrong — a
 * duplicate subscription, an abandoned attempt, a webhook that never arrived. Ask Stripe what
 * exists and end all of it.
 *
 * Returns what it cancelled, so the caller can report rather than assert.
 */
export async function terminateAllSubscriptions(
  user: User
): Promise<{ id: string; wasStatus: string }[]> {
  if (!user.stripeCustomerId) return [];

  const list = await stripe.subscriptions.list({
    customer: user.stripeCustomerId,
    status: "all",
    limit: 100,
  });

  const terminated: { id: string; wasStatus: string }[] = [];

  for (const subscription of list.data) {
    // Already over. Cancelling one of these throws rather than being a no-op.
    if (["canceled", "incomplete_expired"].includes(subscription.status)) continue;

    try {
      await stripe.subscriptions.cancel(subscription.id);
      terminated.push({ id: subscription.id, wasStatus: subscription.status });
    } catch (err) {
      // Keep going. One stubborn subscription must not leave the others live, which would be
      // the worst outcome: a "terminate" that half worked.
      console.error(`[debug] could not cancel ${subscription.id}:`, err);
    }
  }

  return terminated;
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
