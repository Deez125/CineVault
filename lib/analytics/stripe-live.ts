import "server-only";

import type Stripe from "stripe";
import { stripe } from "@/lib/stripe/client";

/**
 * Live Stripe → the "how are we doing right now" numbers on the analytics page.
 *
 * Distinct from `metrics_snapshot`, which is history. This module answers "right this
 * second, how many active subs, what's the MRR, who's cancelling, what will next month
 * look like." The nightly snapshotter calls this one function too — the same normalisation
 * has to run over every historical row we write, and having two calculators would drift.
 *
 * Cached in-memory per process for CACHE_MS to keep admin refreshes from thrashing Stripe;
 * the cache is deliberately small and non-shared (worker + web have their own copies) —
 * an out-of-date figure on a debug page is cheap, a stale figure would only be a minute
 * old, and the invalidation problem is not worth solving for this.
 */

/**
 * A subscription in "cancels at period end" isn't gone yet — it's the number that changes
 * next month, not this one. Present-tense metrics count them as active, future-tense
 * (projections) subtract them.
 *
 * `past_due` is INCLUDED in active + MRR because the customer is still billed and access
 * hasn't been pulled yet. Its money is broken out separately as "at risk" so the admin can
 * see how much of the headline number depends on a retry succeeding.
 */
const ACTIVE_STATUSES: Stripe.Subscription.Status[] = ["active", "past_due"];

export type TierBucket = { streamLimit: number; count: number; mrrCents: number };

/**
 * The per-subscription detail the "click a stat card" popup shows.
 *
 * One row per subscription, whatever its status. The analytics page filters this list
 * per-card — "active subs" shows one subset, "past due" another, etc. Everything the popup
 * displays comes from THIS type; the popup itself performs no additional Stripe calls.
 */
export type SubscriptionDetail = {
  subId: string;
  customerId: string;
  email: string | null;
  displayName: string | null;
  /** "active" | "past_due" | "canceled" | "trialing" | "incomplete" | ... — Stripe's own. */
  status: Stripe.Subscription.Status;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  /** Plan tier in stream count. Read from price.metadata.streams. 0 when unknown. */
  streamLimit: number;
  /** e.g. "$20 / month". Human-readable label of the plan they're on. */
  planLabel: string;

  // ── money, in cents ────────────────────────────────────────────────────────
  /** List price × qty, normalised to monthly. Pre-discount, pre-credit. */
  listMonthlyCents: number;
  /** Recurring monthly reduction from any subscription-level coupon. */
  discountMonthlyCents: number;
  /** Coupon name/label, if any. */
  discountLabel: string | null;
  /**
   * Customer's Stripe balance, positive when they have credit sitting on their account. Not
   * subtracted from MRR (credit is a one-off invoice reduction, not a recurring change),
   * but shown alongside the sub so the admin sees the whole story per customer.
   */
  creditBalanceCents: number;
  /**
   * `listMonthlyCents − discountMonthlyCents`. What this subscription contributes to MRR
   * every month. Credit is separate — it applies once at the next invoice.
   */
  effectiveMonthlyCents: number;
};

export type LiveMetrics = {
  // ── headline counts ────────────────────────────────────────────────────────
  activeSubscribers: number;
  trialingSubscribers: number;
  pastDueSubscribers: number;
  /** Subs with `cancel_at_period_end=true` — they're active NOW, gone at renewal. */
  cancellingSubscribers: number;

  // ── money, all in cents ───────────────────────────────────────────────────
  mrrCents: number;
  /** MRR contributed by past-due subscriptions — subset of mrrCents, not additional. */
  atRiskMrrCents: number;
  /** MRR contributed by subs already scheduled to cancel — subset of mrrCents. */
  cancellingMrrCents: number;
  arpuCents: number;

  // ── projections ───────────────────────────────────────────────────────────
  /**
   * What we book this cycle. Present-tense: everyone currently on the hook, including subs
   * flagged to cancel at period end — they still pay for THIS period.
   */
  thisMonthCents: number;
  /**
   * What we book NEXT cycle, assuming nobody new signs up and nobody currently active
   * churns unexpectedly. Everyone flagged to cancel at period end is subtracted; past-due
   * subs stay in (they SHOULD collect).
   */
  nextMonthCents: number;

  // ── per-tier breakdown, useful in the UI and in the snapshot ──────────────
  byTier: TierBucket[];

  // ── per-subscription detail for the click-through popup ───────────────────
  /**
   * Every subscription Stripe reports, in every status, with pricing broken down. The Now
   * section slices this list per card — "MRR" shows active, "Past due" shows past_due, and
   * so on — so a click reveals "where every dollar comes from."
   */
  details: SubscriptionDetail[];

  // ── metadata ──────────────────────────────────────────────────────────────
  fetchedAt: Date;
};

const CACHE_MS = 60_000;
type CacheEntry = { at: number; value: LiveMetrics };
let cache: CacheEntry | null = null;

/** Bust the cache. Called from server actions that just wrote a Stripe change. */
export function invalidateLiveMetricsCache(): void {
  cache = null;
}

export async function getLiveMetrics(): Promise<LiveMetrics> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.value;

  const subscriptions = await listAllSubscriptions();
  const value = computeLiveMetrics(subscriptions);
  cache = { at: now, value };
  return value;
}

/**
 * Auto-paginate `subscriptions.list`. `status: "all"` so we see canceled subs too — those
 * feed the churn side and don't cost anything to pull; the counts we care about filter on
 * status after the fact.
 *
 * Expansions:
 *   - `data.items.data.price` — to read unit_amount and metadata.streams
 *   - `data.customer` — inline customer object with email + balance, one call instead of N
 *   - `data.discounts.coupon` — coupon details for any discount attached to the sub. The
 *     modern Stripe API returns `discounts` as an array of ids; expanding drills into the
 *     coupon so we can see percent_off / amount_off / name without a second call per sub.
 */
async function listAllSubscriptions(): Promise<Stripe.Subscription[]> {
  const out: Stripe.Subscription[] = [];
  let startingAfter: string | undefined = undefined;
  for (;;) {
    const page = await stripe.subscriptions.list({
      status: "all",
      limit: 100,
      starting_after: startingAfter,
      expand: [
        "data.items.data.price",
        "data.customer",
        "data.discounts.coupon",
      ],
    });
    out.push(...page.data);
    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1]?.id;
    if (!startingAfter) break;
  }
  return out;
}

/**
 * Pure function so the snapshot writer can reuse it against a list read once, without
 * refetching. Exported for testing.
 */
export function computeLiveMetrics(subscriptions: Stripe.Subscription[]): LiveMetrics {
  let activeSubscribers = 0;
  let trialingSubscribers = 0;
  let pastDueSubscribers = 0;
  let cancellingSubscribers = 0;
  let mrrCents = 0;
  let atRiskMrrCents = 0;
  let cancellingMrrCents = 0;
  let thisMonthCents = 0;
  let nextMonthCents = 0;

  const tiers = new Map<number, TierBucket>();
  const details: SubscriptionDetail[] = subscriptions.map(subscriptionDetail);

  for (const sub of subscriptions) {
    if (sub.status === "trialing") {
      trialingSubscribers += 1;
      continue;
    }

    if (!ACTIVE_STATUSES.includes(sub.status)) continue;

    const listMonthly = subscriptionListMonthlyCents(sub);
    if (listMonthly === 0) continue;
    const discount = subscriptionDiscountMonthlyCents(sub, listMonthly);
    const effective = Math.max(0, listMonthly - discount);

    activeSubscribers += 1;
    mrrCents += effective;
    thisMonthCents += effective;

    if (sub.status === "past_due") {
      pastDueSubscribers += 1;
      atRiskMrrCents += effective;
    }

    if (sub.cancel_at_period_end) {
      cancellingSubscribers += 1;
      cancellingMrrCents += effective;
      // They still pay this month; they DON'T pay next month.
    } else {
      nextMonthCents += effective;
    }

    // Tier bucket comes from streamLimit in price metadata — Stripe products carry it as
    // metadata.streams (see lib/stripe/tiers.ts). Fall back to 0 for anything that doesn't.
    const streamLimit = subscriptionStreamLimit(sub);
    const bucket = tiers.get(streamLimit) ?? { streamLimit, count: 0, mrrCents: 0 };
    bucket.count += 1;
    bucket.mrrCents += effective;
    tiers.set(streamLimit, bucket);
  }

  const arpuCents = activeSubscribers > 0 ? Math.round(mrrCents / activeSubscribers) : 0;

  return {
    activeSubscribers,
    trialingSubscribers,
    pastDueSubscribers,
    cancellingSubscribers,
    mrrCents,
    atRiskMrrCents,
    cancellingMrrCents,
    arpuCents,
    thisMonthCents,
    nextMonthCents,
    byTier: [...tiers.values()].sort((a, b) => a.streamLimit - b.streamLimit),
    details,
    fetchedAt: new Date(),
  };
}

// ── per-subscription detail ─────────────────────────────────────────────────

function subscriptionDetail(sub: Stripe.Subscription): SubscriptionDetail {
  const listMonthly = subscriptionListMonthlyCents(sub);
  const discountMonthly = subscriptionDiscountMonthlyCents(sub, listMonthly);
  const effective = Math.max(0, listMonthly - discountMonthly);
  const streamLimit = subscriptionStreamLimit(sub);

  // Customer expand attaches the whole object; pull email + balance from there so this
  // is one API call per page, not one per subscription. Balance is negative when the
  // customer has credit — flip the sign so the popup reads "credit = positive number".
  const customer = sub.customer as Stripe.Customer | Stripe.DeletedCustomer | string;
  let email: string | null = null;
  let displayName: string | null = null;
  let creditBalance = 0;
  if (typeof customer === "object" && customer && !("deleted" in customer && customer.deleted)) {
    const full = customer as Stripe.Customer;
    email = full.email ?? null;
    displayName = full.name ?? null;
    // Balance is negative when the customer has credit sitting on their account.
    if (typeof full.balance === "number" && full.balance < 0) {
      creditBalance = -full.balance;
    }
  }

  return {
    subId: sub.id,
    customerId: typeof customer === "string" ? customer : customer.id,
    email,
    displayName,
    status: sub.status,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    currentPeriodEnd: subscriptionPeriodEnd(sub),
    streamLimit,
    planLabel: planLabelFor(sub),
    listMonthlyCents: listMonthly,
    discountMonthlyCents: discountMonthly,
    discountLabel: discountLabelFor(sub),
    creditBalanceCents: creditBalance,
    effectiveMonthlyCents: effective,
  };
}

/**
 * Subscription period-end. Stripe surfaces this at the ITEM level on modern subs (a sub
 * may have items on different cycles); the sub-level `current_period_end` still exists
 * but is deprecated. Reading the earliest item's period end covers both.
 */
function subscriptionPeriodEnd(sub: Stripe.Subscription): Date | null {
  // `any` because the field is deprecated on the type surface but still populated in most
  // payloads. Item-level is the modern place, but not every response includes it.
  const subLevel = (sub as unknown as { current_period_end?: number }).current_period_end;
  const itemLevel = sub.items.data
    .map((i) => (i as unknown as { current_period_end?: number }).current_period_end)
    .filter((n): n is number => typeof n === "number");

  const ts = itemLevel.length > 0 ? Math.min(...itemLevel) : subLevel;
  if (!ts) return null;
  return new Date(ts * 1000);
}

function planLabelFor(sub: Stripe.Subscription): string {
  const item = sub.items.data[0];
  const price = item?.price;
  if (!price?.unit_amount || !price.recurring) return "Unknown plan";

  const dollars = formatDollars(price.unit_amount * (item.quantity ?? 1));
  const interval = price.recurring.interval;
  const count = price.recurring.interval_count ?? 1;
  const intervalLabel =
    count > 1 ? `${count} ${interval}s` : interval === "month" ? "month" : interval;

  return `${dollars} / ${intervalLabel}`;
}

function formatDollars(cents: number): string {
  const dollars = cents / 100;
  return dollars % 1 === 0 ? `$${dollars.toFixed(0)}` : `$${dollars.toFixed(2)}`;
}

function discountLabelFor(sub: Stripe.Subscription): string | null {
  const coupon = firstCoupon(sub);
  if (!coupon) return null;

  if (coupon.name) return coupon.name;
  if (coupon.percent_off) return `${coupon.percent_off}% off`;
  if (coupon.amount_off) return `${formatDollars(coupon.amount_off)} off`;
  return "Discounted";
}

/**
 * Read the first coupon attached to a subscription, whether via the deprecated `discount`
 * property or the modern `discounts` array. Both may be present depending on how the
 * subscription was created and which SDK version wrote it.
 *
 * Cast-heavy on purpose: the Stripe SDK type surface for this API pin omits `Discount.coupon`
 * from its declaration, but the runtime object still carries it when the `discounts.coupon`
 * expansion is requested. Newer SDKs will restore the field to the type and these casts
 * become no-ops.
 */
function firstCoupon(sub: Stripe.Subscription): Stripe.Coupon | null {
  type CouponBearingDiscount = { coupon?: Stripe.Coupon | null };

  // Modern: sub.discounts is an array of discount ids OR expanded discount objects.
  const discounts = (sub as unknown as { discounts?: Array<CouponBearingDiscount | string> })
    .discounts;
  if (Array.isArray(discounts)) {
    for (const d of discounts) {
      if (typeof d === "object" && d?.coupon) return d.coupon;
    }
  }

  // Legacy: sub.discount is a single discount object (or null).
  const legacy = (sub as unknown as { discount?: CouponBearingDiscount | null }).discount;
  if (legacy?.coupon) return legacy.coupon;

  return null;
}

// ── pricing math ────────────────────────────────────────────────────────────

/**
 * List (pre-discount) monthly cents for a subscription.
 *
 * Rules (from the spec, verbatim, so history and live stay consistent):
 *   - monthly → unit_amount × quantity
 *   - yearly  → (unit_amount × quantity) / 12
 *   - weekly  → (unit_amount × quantity) × 52 / 12
 * Divided by recurring.interval_count when it's greater than 1 (a "3-month" plan bills every
 * 3 months at N; monthly value is N / 3).
 *
 * Sums across every item on the subscription; a single sub with a "base plan + add-on" is
 * two items, and both contribute.
 */
function subscriptionListMonthlyCents(sub: Stripe.Subscription): number {
  let cents = 0;

  for (const item of sub.items.data) {
    const price = item.price;
    if (!price?.unit_amount || !price.recurring) continue;

    const qty = item.quantity ?? 1;
    const base = price.unit_amount * qty;

    let monthly: number;
    switch (price.recurring.interval) {
      case "month":
        monthly = base;
        break;
      case "year":
        monthly = base / 12;
        break;
      case "week":
        monthly = (base * 52) / 12;
        break;
      case "day":
        monthly = base * 30;
        break;
      default:
        monthly = 0;
    }

    const intervalCount = price.recurring.interval_count ?? 1;
    if (intervalCount > 1) monthly = monthly / intervalCount;

    cents += monthly;
  }

  return Math.round(cents);
}

/**
 * How much the subscription-level discount reduces the monthly figure.
 *
 * `percent_off` scales the list price; `amount_off` is a flat reduction. The flat case has
 * to be normalised to monthly the same way the list is — a $60 amount_off on a yearly plan
 * is $5/mo. Returns 0 for no coupon.
 */
function subscriptionDiscountMonthlyCents(sub: Stripe.Subscription, listMonthly: number): number {
  const coupon = firstCoupon(sub);
  if (!coupon) return 0;

  if (coupon.percent_off) {
    return Math.round(listMonthly * (coupon.percent_off / 100));
  }
  if (coupon.amount_off) {
    // Coupons carry a `duration` — "once", "forever", "repeating". A "once" coupon shouldn't
    // reduce MRR at all (it's a one-time invoice reduction, not a recurring change). We
    // treat "once" as $0 impact on MRR; the popup surfaces the coupon name separately so
    // the admin still sees it applied.
    if (coupon.duration === "once") return 0;

    const item = sub.items.data[0];
    const price = item?.price;
    const interval = price?.recurring?.interval;
    if (!interval) return coupon.amount_off;

    switch (interval) {
      case "month":
        return coupon.amount_off;
      case "year":
        return Math.round(coupon.amount_off / 12);
      case "week":
        return Math.round((coupon.amount_off * 52) / 12);
      case "day":
        return coupon.amount_off * 30;
      default:
        return coupon.amount_off;
    }
  }
  return 0;
}

/**
 * Read the streamLimit off the subscription's price metadata.
 *
 * Prices carry `metadata.streams` set by scripts/stripe/setup.ts. Reading it here means the
 * per-tier breakdown holds up even after a price is retired — the metadata lives on the price
 * object, not on a lookup table we own.
 */
function subscriptionStreamLimit(sub: Stripe.Subscription): number {
  for (const item of sub.items.data) {
    const streams = item.price?.metadata?.streams;
    if (streams) {
      const n = Number(streams);
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}
