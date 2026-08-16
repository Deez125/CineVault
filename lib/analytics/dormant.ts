// Deliberately NOT marked `server-only`: refreshUserActivity is called by the background
// worker (plain Node), and `server-only` throws in every non-RSC caller. Same reason as
// lib/analytics/snapshot.ts.

import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, userActivity } from "@/lib/db/schema";
import { fetchLastWatchedAt } from "./plex-history";
import { logEvent, logError } from "@/lib/events";

/**
 * Who is subscribed and quietly not using it.
 *
 * The panel that reads this is the one Stripe cannot produce, because dormancy is a JOIN
 * between billing and playback. We keep the join cheap by caching each user's
 * `last_watched_at` in user_activity, refreshed once a night by the worker. The panel just
 * reads from that cache.
 *
 * Bucketing rules from the spec:
 *   - 7d / 8–30d / 31–60d / 60d+ / never — days since last watch
 *   - Onboarding: subscribed within the last 7 days → excluded from dormancy entirely;
 *     they haven't had time to become dormant yet.
 *   - Unlinked: subscribed but no plex_user_id → separate bucket, because that's a
 *     provisioning bug rather than a churn risk.
 */

export type DormantBucket = "onboarding" | "unlinked" | "recent" | "week" | "month" | "twoMonths" | "long" | "never";

export type DormantRow = {
  userId: string;
  email: string;
  displayName: string | null;
  streamLimit: number;
  monthlyCents: number | null;
  subscriptionAgeDays: number;
  lastWatchedAt: Date | null;
  daysSinceWatched: number | null;
  bucket: DormantBucket;
};

const ONBOARDING_DAYS = 7;

/**
 * Every active subscriber with their dormancy bucket.
 *
 * Sorted by MRR desc so the panel can render "who to worry about first" without a second
 * sort — a dormant top-tier subscriber matters more than a dormant base-tier one.
 *
 * Everything comes from ONE joined query: no per-user Plex calls, no per-user Stripe calls.
 * The cache handles both because the nightly job pre-fetched.
 */
export async function listDormantSubscribers(now: Date = new Date()): Promise<DormantRow[]> {
  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      username: users.username,
      streamLimit: users.streamLimit,
      monthlyCents: users.subAmount,
      subInterval: users.subInterval,
      plexUserId: users.plexUserId,
      createdAt: users.createdAt,
      lastWatchedAt: userActivity.lastWatchedAt,
    })
    .from(users)
    .leftJoin(userActivity, eq(userActivity.userId, users.id))
    .where(eq(users.isMember, true));

  return rows
    .map((r) => shape(r, now))
    // Onboarding rows go to the bottom of "not really dormant"; the caller can group by
    // bucket for the UI. Sorting by monthly desc gives the panel a useful default order.
    .sort((a, b) => (b.monthlyCents ?? 0) - (a.monthlyCents ?? 0));
}

function shape(
  r: {
    userId: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    username: string | null;
    streamLimit: number;
    monthlyCents: number | null;
    subInterval: string | null;
    plexUserId: string | null;
    createdAt: Date;
    lastWatchedAt: Date | null;
  },
  now: Date
): DormantRow {
  const subscriptionAgeDays = Math.floor(
    (now.getTime() - r.createdAt.getTime()) / (24 * 60 * 60 * 1000)
  );

  // Approximate monthly amount from the cached sub interval — treats yearly as /12, weekly
  // as ×52/12. Same logic as stripe-live.ts, deliberately duplicated here (small, and
  // avoids dragging Stripe into a query path).
  const monthlyCents = normaliseMonthly(r.monthlyCents, r.subInterval);

  const base = {
    userId: r.userId,
    email: r.email,
    displayName: displayNameFor(r),
    streamLimit: r.streamLimit,
    monthlyCents,
    subscriptionAgeDays,
    lastWatchedAt: r.lastWatchedAt,
  };

  if (!r.plexUserId) {
    return { ...base, daysSinceWatched: null, bucket: "unlinked" };
  }
  if (subscriptionAgeDays < ONBOARDING_DAYS) {
    return { ...base, daysSinceWatched: null, bucket: "onboarding" };
  }
  if (!r.lastWatchedAt) {
    return { ...base, daysSinceWatched: null, bucket: "never" };
  }

  const days = Math.floor((now.getTime() - r.lastWatchedAt.getTime()) / (24 * 60 * 60 * 1000));
  let bucket: DormantBucket;
  if (days <= 7) bucket = "recent";
  else if (days <= 30) bucket = "week";
  else if (days <= 60) bucket = "month";
  else bucket = "long";

  return { ...base, daysSinceWatched: days, bucket };
}

function displayNameFor(r: { firstName: string | null; lastName: string | null; username: string | null; email: string }): string {
  const full = [r.firstName, r.lastName].filter(Boolean).join(" ").trim();
  return full || r.username || r.email;
}

function normaliseMonthly(amount: number | null, interval: string | null): number | null {
  if (amount === null) return null;
  switch (interval) {
    case "month":
      return amount;
    case "year":
      return Math.round(amount / 12);
    case "week":
      return Math.round((amount * 52) / 12);
    case "day":
      return Math.round(amount * 30);
    default:
      return amount;
  }
}

/**
 * Refresh the user_activity cache for every subscribed, linked user.
 *
 * Called nightly. One Plex request per user, sequenced (not parallel) so we don't hammer
 * the server — a hundred subs is a hundred requests taking a couple of seconds each, well
 * under any timeout at this scale. If we ever grow to thousands we batch, but that's a
 * problem for future us.
 *
 * Failures per user are silent inside fetchLastWatchedAt; the aggregate outcome is logged
 * once at the end.
 */
export async function refreshUserActivity(): Promise<{ checked: number; updated: number; durationMs: number }> {
  const started = Date.now();

  const eligible = await db
    .select({ id: users.id, plexUserId: users.plexUserId })
    .from(users)
    .where(and(eq(users.isMember, true), isNotNull(users.plexUserId)));

  let updated = 0;
  for (const u of eligible) {
    if (!u.plexUserId) continue;

    const lastWatched = await fetchLastWatchedAt(u.plexUserId);

    // Upsert. Preserves transcode_count_30d so the top-transcoders pass (when it lands)
    // can be a separate updater without stomping this column.
    try {
      await db
        .insert(userActivity)
        .values({
          userId: u.id,
          lastWatchedAt: lastWatched,
        })
        .onConflictDoUpdate({
          target: userActivity.userId,
          set: { lastWatchedAt: lastWatched, updatedAt: new Date() },
        });
      updated += 1;
    } catch (err) {
      await logError("could not update user_activity", {
        error: err instanceof Error ? err.message : String(err),
        userId: u.id,
      });
    }
  }

  const durationMs = Date.now() - started;
  await logEvent({
    type: "user_activity_refresh",
    severity: "info",
    actor: "system",
    message: `refreshed user_activity for ${updated}/${eligible.length} users in ${durationMs}ms`,
    detail: { checked: eligible.length, updated, durationMs },
  });

  return { checked: eligible.length, updated, durationMs };
}

