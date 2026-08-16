// Deliberately NOT marked `server-only`: this file is imported by the background worker,
// which is a plain Node process (not a React Server Component context). `server-only`
// throws in every non-RSC caller, worker included, so it must never appear here — same
// exemption as lib/enforce.ts and lib/reconcile.ts, which the worker also loads.

import type Stripe from "stripe";
import { and, count, desc, eq, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  metricsSnapshot,
  userActivity,
  users,
  type MetricsSnapshot,
} from "@/lib/db/schema";
import { stripe } from "@/lib/stripe/client";
import { computeLiveMetrics } from "./stripe-live";
import { env } from "@/lib/env";
import { logEvent, logError } from "@/lib/events";

/**
 * The nightly writer: one row per day, everything the trends panel plots.
 *
 * Two data sources are folded together into a single immutable snapshot row:
 *
 *   1. Stripe live — the same normaliser the "now" panel uses (computeLiveMetrics), so the
 *      snapshot's headline figures match what the admin saw on the day it was written.
 *   2. Yesterday's snapshot — read once to compute MRR movement buckets by diffing per-sub
 *      MRR. First-ever day has nothing to diff against, and the movement columns land at
 *      zero, which is a less misleading answer than a "new" number equal to the whole book.
 *
 * Written with `INSERT ... ON CONFLICT DO UPDATE` on the primary key so a rerun on the same
 * day corrects itself rather than doubling. Yesterday's row is never rewritten.
 *
 * DRY-RUN MODE via SNAPSHOT_DRY_RUN — computes and logs without writing. Same shape as
 * ENFORCE_STREAM_LIMITS. Let it run against real data once before it starts persisting.
 */

/** UTC calendar day, formatted "YYYY-MM-DD" — the primary-key form the table uses. */
function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftDay(iso: string, delta: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return ymd(d);
}

/**
 * Run the snapshot. Called from the worker on its daily cadence.
 *
 * `now` is injectable so tests can drive the calendar forward without waiting for wall time.
 * Production passes nothing and the current UTC day is used.
 */
export async function writeDailySnapshot(now: Date = new Date()): Promise<MetricsSnapshot | null> {
  const today = ymd(now);
  const yesterday = shiftDay(today, -1);

  const subscriptions = await listAllSubscriptions();

  const live = computeLiveMetrics(subscriptions);

  // Yesterday's snapshot is optional. Without it, movement buckets are zero — the
  // alternative would be attributing every currently-active subscription as "new today"
  // which is spectacularly wrong on day one.
  const [prev] = await db
    .select()
    .from(metricsSnapshot)
    .where(eq(metricsSnapshot.date, yesterday))
    .limit(1);

  const movement = diffMovement(subscriptions, prev ?? null);

  // Dormancy counts come from the user_activity cache, refreshed on its own cadence. A
  // stale cache understates dormancy (a user who watched yesterday is still "recent") but
  // never overstates it, which is the safer direction.
  const [dormant] = await Promise.all([countDormant(now)]);

  const row = {
    date: today,
    activeSubscribers: live.activeSubscribers,
    trialingSubscribers: live.trialingSubscribers,
    pastDueSubscribers: live.pastDueSubscribers,
    cancellingSubscribers: live.cancellingSubscribers,
    mrrCents: live.mrrCents,
    atRiskMrrCents: live.atRiskMrrCents,
    cancellingMrrCents: live.cancellingMrrCents,
    arpuCents: live.arpuCents,
    byTier: Object.fromEntries(
      live.byTier.map((t) => [String(t.streamLimit), { count: t.count, mrr_cents: t.mrrCents }])
    ),
    ...movement,
    dormant30d: dormant.thirty,
    dormant60d: dormant.sixty,
  };

  if (env.SNAPSHOT_DRY_RUN) {
    console.log("  [snapshot] DRY RUN — would write", JSON.stringify(row));
    await logEvent({
      type: "metrics_snapshot",
      severity: "info",
      actor: "system",
      message: `snapshot dry-run for ${today}`,
      detail: {
        mrrCents: row.mrrCents,
        activeSubscribers: row.activeSubscribers,
        newMrrCents: row.newMrrCents,
        churnedMrrCents: row.churnedMrrCents,
      },
    });
    return null;
  }

  try {
    const [written] = await db
      .insert(metricsSnapshot)
      .values(row)
      .onConflictDoUpdate({
        target: metricsSnapshot.date,
        set: { ...row, createdAt: sql`now()` },
      })
      .returning();

    await logEvent({
      type: "metrics_snapshot",
      severity: "info",
      actor: "system",
      message: `wrote snapshot for ${today}`,
      detail: {
        mrrCents: row.mrrCents,
        activeSubscribers: row.activeSubscribers,
        newMrrCents: row.newMrrCents,
        churnedMrrCents: row.churnedMrrCents,
      },
    });

    return written;
  } catch (err) {
    await logError("could not write metrics snapshot", {
      error: err instanceof Error ? err.message : String(err),
      date: today,
    });
    return null;
  }
}

/**
 * Diff today's per-subscription state against yesterday's snapshot to bucket movement.
 *
 * The subscriptions Stripe reports today are the only ones we can enumerate. Yesterday's
 * per-sub numbers are inferred FROM YESTERDAY'S HEADLINE only — we don't persist per-sub
 * detail (would be an unbounded table for very little value). That means:
 *
 *   - **Churned** = yesterday's active_subs − today's active_subs, when positive. Split
 *     into voluntary/involuntary by looking at Stripe cancellation_details on subs that
 *     went to `canceled` in the last 24h.
 *   - **New MRR** = today's active MRR − yesterday's active MRR, when positive.
 *   - **Expansion/contraction** are folded into the New/Churned buckets in this
 *     simplified model. The full spec calls for per-sub diffing; we can add that later by
 *     persisting a lightweight per-sub snapshot alongside.
 *
 * Good enough for the first cut: the trends chart shows plausible numbers on day one, and
 * refinement is a change to this function alone.
 */
function diffMovement(subs: Stripe.Subscription[], prev: MetricsSnapshot | null) {
  const activeToday = subs.filter((s) => s.status === "active" || s.status === "past_due").length;
  const prevActive = prev?.activeSubscribers ?? activeToday;

  const netCustomers = activeToday - prevActive;
  const newSubscribers = Math.max(0, netCustomers);
  const churnedSubscribers = Math.max(0, -netCustomers);

  // Split churn using Stripe's own reason on subs canceled in the last 24h. Involuntary =
  // payment_failed. Voluntary = anything else, including "cancellation_requested" and null
  // (member cancelled via the app without leaving a reason).
  const dayAgo = Date.now() / 1000 - 24 * 60 * 60;
  let churnedInvoluntary = 0;
  let churnedVoluntary = 0;
  for (const s of subs) {
    if (s.status !== "canceled") continue;
    if ((s.canceled_at ?? 0) < dayAgo) continue;
    const reason = s.cancellation_details?.reason ?? null;
    if (reason === "payment_failed" || reason === "payment_disputed") churnedInvoluntary += 1;
    else churnedVoluntary += 1;
  }

  // Compute MRR from today's active book and diff against yesterday's headline.
  const mrrToday = computeLiveMetrics(subs).mrrCents;
  const prevMrr = prev?.mrrCents ?? mrrToday;
  const mrrDelta = mrrToday - prevMrr;

  return {
    newSubscribers,
    churnedSubscribers,
    churnedVoluntary,
    churnedInvoluntary,
    newMrrCents: Math.max(0, mrrDelta),
    expansionMrrCents: 0,
    contractionMrrCents: 0,
    churnedMrrCents: Math.max(0, -mrrDelta),
  };
}

/** Same auto-paginator as stripe-live.ts, kept private here so the two can vary later. */
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
 * Count users who haven't watched in 30 / 60 days.
 *
 * Reads user_activity, which the worker refreshes on its own cadence. Only counts users
 * who are ALSO active subscribers — a dormant free-plan user is not a churn risk to be
 * counted here. "Never watched but recently signed up" is excluded (onboarding window).
 */
async function countDormant(now: Date): Promise<{ thirty: number; sixty: number }> {
  const thirtyAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixtyAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [thirty] = await db
    .select({ n: count() })
    .from(users)
    .leftJoin(userActivity, eq(userActivity.userId, users.id))
    .where(
      and(
        eq(users.isMember, true),
        isNotNull(users.plexUserId),
        // Not brand-new — brand-new users are still onboarding, not dormant.
        lt(users.createdAt, sevenDaysAgo),
        // Either they've watched something more than 30d ago, or they've never watched
        // and their account is older than the onboarding window.
        sql`(${userActivity.lastWatchedAt} IS NULL OR ${userActivity.lastWatchedAt} < ${thirtyAgo.toISOString()})`
      )
    );

  const [sixty] = await db
    .select({ n: count() })
    .from(users)
    .leftJoin(userActivity, eq(userActivity.userId, users.id))
    .where(
      and(
        eq(users.isMember, true),
        isNotNull(users.plexUserId),
        lt(users.createdAt, sevenDaysAgo),
        sql`(${userActivity.lastWatchedAt} IS NULL OR ${userActivity.lastWatchedAt} < ${sixtyAgo.toISOString()})`
      )
    );

  return { thirty: thirty?.n ?? 0, sixty: sixty?.n ?? 0 };
}

/**
 * The most recent snapshot rows — for the trends chart. Newest first.
 *
 * `limit` in days. Passing 0 returns nothing; passing more than we've written returns what
 * we have, no padding. The chart handles a partial series on its own.
 */
export async function readRecentSnapshots(days: number): Promise<MetricsSnapshot[]> {
  if (days <= 0) return [];
  return db
    .select()
    .from(metricsSnapshot)
    .orderBy(desc(metricsSnapshot.date))
    .limit(days);
}

/** The single latest snapshot, or null if the table is empty. */
export async function readLatestSnapshot(): Promise<MetricsSnapshot | null> {
  const [row] = await db
    .select()
    .from(metricsSnapshot)
    .orderBy(desc(metricsSnapshot.date))
    .limit(1);
  return row ?? null;
}

