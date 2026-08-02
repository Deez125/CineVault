import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type User } from "@/lib/db/schema";
import { stripe, isEntitling } from "@/lib/stripe/client";
import { streamsForPrice } from "@/lib/stripe/tiers";
import { logEvent, logError, type Actor } from "@/lib/events";
import { isProtected } from "@/lib/plex/protected";
import { plexConfigured } from "@/lib/env";
import { grantPlexAccess, revokePlexAccess } from "@/lib/plex/share";

/**
 * THE ONE DOOR.
 *
 * `applyEntitlement()` is the only function in this codebase that changes what a member can
 * access. The Stripe webhook calls it, the periodic reconciler calls it, the admin panel calls
 * it. Nothing else may write `is_member`, `stream_limit`, or `share_state`.
 *
 * Access changes are the dangerous operations here — getting one wrong means either giving
 * away a paid product or cutting off someone who paid — so there is exactly one place to get
 * them right, and it is this one. Keep it that way. If you are tempted to "just set the flag"
 * somewhere else, that is the moment the system starts having two answers to the same
 * question.
 *
 * IT IS IDEMPOTENT BY DESIGN. Stripe redelivers webhooks. The reconciler re-runs every five
 * minutes. Both can land at the same instant. So every call recomputes the desired state from
 * scratch and moves toward it: running it twice equals running it once.
 */

export type ApplyOptions = {
  /**
   * The subscription to judge by. When omitted, it is fetched from Stripe.
   *
   * The webhook passes the object it was handed; the reconciler passes what it listed. Both
   * beat re-fetching, and the reconciler in particular would otherwise make one API call per
   * member every five minutes.
   */
  subscription?: Stripe.Subscription | null;
  actor?: Actor;
  /** Skip the Plex side. Used when the caller is about to do its own provisioning. */
  skipProvisioning?: boolean;
};

export type EntitlementResult = {
  user: User;
  isMember: boolean;
  streamLimit: number;
  changed: boolean;
};

/**
 * Bring a user's access in line with their Stripe subscription.
 *
 * Returns the updated row. Never throws for an ordinary "they aren't entitled" outcome — that
 * is a normal result, not an error.
 */
export async function applyEntitlement(
  userId: string,
  options: ApplyOptions = {}
): Promise<EntitlementResult | null> {
  const actor = options.actor ?? "system";

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    await logError("applyEntitlement called for a user that does not exist", { userId }, { actor });
    return null;
  }

  // ── 1. What does Stripe say? ────────────────────────────────────────────────
  const subscription = options.subscription ?? (await fetchSubscription(user));

  // ── 2. Compute the desired state ────────────────────────────────────────────
  const priceId = subscription?.items.data[0]?.price?.id ?? null;
  const status = subscription?.status ?? null;

  const paidFor = isEntitling(status);
  const streamsFromPrice = paidFor && priceId ? await streamsForPrice(priceId) : 0;

  /**
   * A banned user gets nothing, even with a live, paid subscription.
   *
   * This check lives INSIDE the one door precisely so it cannot be bypassed. If it sat in the
   * admin UI, a webhook arriving a second later would happily undo the ban.
   */
  const desiredIsMember = paidFor && !user.banned && streamsFromPrice > 0;
  const desiredStreams = desiredIsMember ? streamsFromPrice : 0;

  // ── 3. Work out what actually changed, for the audit log ───────────────────
  const wasMember = user.isMember;
  const hadStreams = user.streamLimit;
  const wasCancelling = user.subCancelAtPeriodEnd;

  const item = subscription?.items.data[0];
  const price = item?.price;

  const patch = {
    stripeSubscriptionId: subscription?.id ?? user.stripeSubscriptionId,
    subStatus: status,
    subPriceId: priceId,
    subAmount: price?.unit_amount ?? null,
    subCurrency: price?.currency ?? null,
    subInterval: price?.recurring?.interval ?? null,
    subCancelAtPeriodEnd: subscription?.cancel_at_period_end ?? false,
    subCurrentPeriodEnd: periodEnd(subscription),
    isMember: desiredIsMember,
    streamLimit: desiredStreams,
    updatedAt: new Date(),
  };

  const [updated] = await db
    .update(users)
    .set(patch)
    .where(eq(users.id, userId))
    .returning();

  const context = {
    userId: updated.id,
    email: updated.email,
    plexUsername: updated.plexUsername,
    actor,
  };

  // ── 4. Record the transitions ───────────────────────────────────────────────
  if (!wasMember && desiredIsMember) {
    await logEvent({
      ...context,
      type: "membership_gained",
      message: `${updated.email} subscribed`,
      detail: { streams: desiredStreams, status, amount: price?.unit_amount, currency: price?.currency },
    });
  } else if (wasMember && !desiredIsMember) {
    await logEvent({
      ...context,
      type: "membership_lost",
      severity: "warn",
      message: user.banned
        ? `${updated.email} is banned and has been denied access`
        : `${updated.email} is no longer subscribed`,
      detail: { status, banned: user.banned },
    });
  } else if (wasMember && desiredIsMember && hadStreams !== desiredStreams) {
    await logEvent({
      ...context,
      type: "tier_changed",
      message: `${updated.email} moved from ${hadStreams} to ${desiredStreams} user${desiredStreams === 1 ? "" : "s"}`,
      detail: { from: hadStreams, to: desiredStreams },
    });
  }

  if (!wasCancelling && updated.subCancelAtPeriodEnd) {
    await logEvent({
      ...context,
      type: "cancel_scheduled",
      severity: "warn",
      message: `${updated.email} cancelled, access ends ${formatDate(updated.subCurrentPeriodEnd)}`,
      detail: { endsAt: updated.subCurrentPeriodEnd?.toISOString() },
    });
  } else if (wasCancelling && !updated.subCancelAtPeriodEnd && desiredIsMember) {
    await logEvent({
      ...context,
      type: "cancel_reversed",
      message: `${updated.email} kept their plan`,
    });
  }

  if (status === "past_due" && user.subStatus !== "past_due") {
    // Not a revocation. `past_due` still entitles: Stripe is retrying the card, and locking
    // someone out before those retries finish turns a temporary card problem into a churn.
    await logEvent({
      ...context,
      type: "payment_failed",
      severity: "warn",
      message: `${updated.email}'s payment failed, Stripe is retrying`,
      detail: { status },
    });
  }

  // ── 5. Provision Plex ───────────────────────────────────────────────────────
  if (!options.skipProvisioning) {
    await syncPlexShare(updated, desiredIsMember, actor);
  }

  return {
    user: updated,
    isMember: desiredIsMember,
    streamLimit: desiredStreams,
    changed: wasMember !== desiredIsMember || hadStreams !== desiredStreams,
  };
}

/**
 * Make the Plex share match the entitlement.
 *
 * Failures here are logged, never thrown. A Plex hiccup must not roll back the database write
 * or stop the rest of the flow: the reconciler runs every few minutes and will try again. The
 * alternative — throwing — means one Plex outage leaves the whole system refusing to record
 * that anybody paid.
 */
async function syncPlexShare(user: User, shouldHaveAccess: boolean, actor: Actor): Promise<void> {
  // Nothing to share with until they have told us who they are on Plex. Plex has no invite
  // links, so a share needs a real Plex identity up front.
  if (!user.plexUsername && !user.plexEmail) return;

  // The hard rail, checked before anything destructive.
  if (isProtected(user.plexUsername)) return;

  if (!plexConfigured()) {
    // Loud, because the alternative is a paying customer silently never being provisioned.
    console.warn(
      `[entitlements] Plex is not configured; ${user.email} needs share_state=${shouldHaveAccess ? "invited" : "removed"} and will be picked up by the reconciler once credentials are set`
    );
    return;
  }

  const alreadyShared = user.shareState === "invited";
  if (shouldHaveAccess === alreadyShared) return;

  const context = {
    userId: user.id,
    email: user.email,
    plexUsername: user.plexUsername,
    actor,
  };

  try {
    if (shouldHaveAccess) {
      await grantPlexAccess(user);
      await db
        .update(users)
        .set({ shareState: "invited", invitedAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, user.id));

      await logEvent({
        ...context,
        type: "access_granted",
        message: `${user.plexUsername ?? user.plexEmail} invited to Plex`,
      });
    } else {
      await revokePlexAccess(user);
      await db
        .update(users)
        .set({ shareState: "removed", removedAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, user.id));

      await logEvent({
        ...context,
        type: "access_revoked",
        severity: "warn",
        message: `${user.plexUsername ?? user.plexEmail} removed from Plex`,
      });
    }
  } catch (err) {
    await logError(
      `Plex ${shouldHaveAccess ? "share" : "unshare"} failed for ${user.email}`,
      { error: err instanceof Error ? err.message : String(err) },
      context
    );
  }
}

/** The subscription we should judge this user by, fetched from Stripe. */
async function fetchSubscription(user: User): Promise<Stripe.Subscription | null> {
  if (!user.stripeCustomerId) return null;

  try {
    // ALL subscriptions for the customer, not just the one we have an id for.
    //
    // The previous build shipped a bug here worth remembering: it looked at whichever
    // subscription Stripe happened to return first, so an old `incomplete_expired` record
    // could outrank the live one and revoke a paying member every five minutes. Pick the
    // entitling one deliberately.
    const list = await stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      status: "all",
      limit: 100,
    });

    return pickEntitling(list.data);
  } catch (err) {
    // Cannot reach Stripe. Return the DB's idea of the subscription rather than null:
    // returning null would read as "not subscribed" and revoke everybody during an outage.
    throw new StripeUnreachableError(
      `could not read subscriptions for ${user.email}: ${err instanceof Error ? err.message : err}`
    );
  }
}

/**
 * The subscription that should decide entitlement.
 *
 * An entitling one always beats a dead one, regardless of the order Stripe returned them in.
 * Among several entitling ones, the most recently created wins.
 */
export function pickEntitling(subscriptions: Stripe.Subscription[]): Stripe.Subscription | null {
  if (subscriptions.length === 0) return null;

  const live = subscriptions
    .filter((s) => isEntitling(s.status))
    .sort((a, b) => b.created - a.created);

  if (live.length > 0) return live[0];

  return [...subscriptions].sort((a, b) => b.created - a.created)[0] ?? null;
}

export class StripeUnreachableError extends Error {
  readonly code = "STRIPE_UNREACHABLE";
  constructor(message: string) {
    super(message);
    this.name = "StripeUnreachableError";
  }
}

/**
 * When the current paid period ends.
 *
 * Lives on the subscription ITEM in current API versions, having moved off the subscription
 * itself. Both are checked because a subscription created before the move still reports the
 * old shape, and reading the wrong one gives every member a renewal date of "Invalid Date".
 */
function periodEnd(subscription: Stripe.Subscription | null | undefined): Date | null {
  if (!subscription) return null;

  const seconds =
    subscription.items?.data[0]?.current_period_end ??
    (subscription as unknown as { current_period_end?: number }).current_period_end;

  return typeof seconds === "number" ? new Date(seconds * 1000) : null;
}

function formatDate(date: Date | null): string {
  if (!date) return "the end of the period";
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}
