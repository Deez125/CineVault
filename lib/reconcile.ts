import type Stripe from "stripe";
import { isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { stripe } from "@/lib/stripe/client";
import { applyEntitlement, pickEntitling } from "@/lib/entitlements";
import { logError } from "@/lib/events";

/**
 * The reconciler.
 *
 * Every few minutes it asks Stripe what is true and makes the database agree. That is the
 * whole job, and it is the safety net under everything else.
 *
 * WHY IT HAS TO EXIST. Webhooks are the fast path, not a guarantee. Stripe cannot reach us
 * during a redeploy. A handler can fail on a database blip. An event can be missed entirely.
 * Without this, any one of those leaves a member silently in the wrong state — still paying
 * with no access, or cancelled with access — until a human happens to notice. With it, the
 * worst case is a few minutes of being wrong.
 *
 * It also does the catching up: anyone who linked Plex while Plex was unconfigured gets
 * provisioned the first time it runs afterwards, without anybody having to go and find them.
 *
 * It is safe to run constantly because `applyEntitlement` is idempotent. Running it and the
 * webhook at the same instant produces the same result as either one alone.
 */

export type ReconcileResult = {
  checked: number;
  changed: number;
  failed: number;
  durationMs: number;
};

/**
 * One pass over every member.
 *
 * Subscriptions are fetched ONCE and grouped by customer rather than queried per user. With a
 * few hundred members the per-user version is a few hundred round trips every five minutes,
 * which is both slow and a good way to meet Stripe's rate limiter.
 */
export async function reconcileAll(): Promise<ReconcileResult> {
  const startedAt = Date.now();

  const members = await db
    .select({ id: users.id, email: users.email, stripeCustomerId: users.stripeCustomerId })
    .from(users)
    .where(isNotNull(users.stripeCustomerId));

  if (members.length === 0) {
    return { checked: 0, changed: 0, failed: 0, durationMs: Date.now() - startedAt };
  }

  let byCustomer: Map<string, Stripe.Subscription[]>;

  try {
    byCustomer = await fetchSubscriptionsByCustomer();
  } catch (err) {
    // Cannot reach Stripe. Do NOTHING.
    //
    // This is the most important line in the file. An empty result would look exactly like
    // "nobody has a subscription", and acting on it would revoke every paying member on the
    // service during a Stripe outage. A skipped run costs a few minutes of staleness; a
    // confident wrong run costs the customer base.
    await logError(
      "reconcile skipped: could not list subscriptions from Stripe",
      { error: err instanceof Error ? err.message : String(err) },
      { actor: "reconciler" }
    );
    return { checked: 0, changed: 0, failed: members.length, durationMs: Date.now() - startedAt };
  }

  let changed = 0;
  let failed = 0;

  for (const member of members) {
    const subscriptions = byCustomer.get(member.stripeCustomerId!) ?? [];

    // Grouped per member, then the entitling one chosen deliberately. The previous build
    // shipped a bug here worth remembering: it took whichever subscription Stripe returned
    // first, so an old incomplete_expired record could outrank the live one and revoke a
    // paying member every five minutes, forever.
    const subscription = pickEntitling(subscriptions);

    try {
      const result = await applyEntitlement(member.id, { subscription, actor: "reconciler" });
      if (result?.changed) changed += 1;
    } catch (err) {
      // One member's failure must not end the pass. The rest still need reconciling, and
      // this one gets another go in a few minutes.
      failed += 1;
      await logError(
        `reconcile failed for ${member.email}`,
        { error: err instanceof Error ? err.message : String(err) },
        { userId: member.id, email: member.email, actor: "reconciler" }
      );
    }
  }

  return { checked: members.length, changed, failed, durationMs: Date.now() - startedAt };
}

/**
 * Every subscription in the account, grouped by customer.
 *
 * Auto-paginates. A `limit` on its own silently truncates at 100, which would look like
 * "these customers have no subscriptions" for everybody past the first page — and that reads
 * as cancel-everyone.
 */
async function fetchSubscriptionsByCustomer(): Promise<Map<string, Stripe.Subscription[]>> {
  const grouped = new Map<string, Stripe.Subscription[]>();

  const all = await stripe.subscriptions
    .list({ status: "all", limit: 100 })
    .autoPagingToArray({ limit: 10_000 });

  for (const subscription of all) {
    const customerId =
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer?.id;

    if (!customerId) continue;

    const existing = grouped.get(customerId);
    if (existing) existing.push(subscription);
    else grouped.set(customerId, [subscription]);
  }

  return grouped;
}

/** Reconcile a single member. Used by the admin panel and the debug panel. */
export async function reconcileOne(userId: string): Promise<boolean> {
  const result = await applyEntitlement(userId, { actor: "reconciler" });
  return Boolean(result?.changed);
}
