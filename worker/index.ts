import "../lib/load-env";

import { env, assertProductionIntegrations, plexConfigured } from "../lib/env";
import { assertEmailConfigured } from "../lib/email";
import { reconcileAll } from "../lib/reconcile";
import { enforceStreamLimits } from "../lib/enforce";
import { refreshRecentlyAdded } from "../lib/plex/recently-added-cache";
import { purgeDeadLinks, sweepExpiredLinks } from "../lib/referrals";
import { pool } from "../lib/db";
import { logError } from "../lib/events";

/**
 * The background worker.
 *
 * A separate process from the web app, because these are LOOPS. A Next.js request handler
 * runs when somebody visits; nobody visits at 4am, which is exactly when a missed webhook
 * needs healing. Same codebase, same database, its own entry point:
 *
 *   npm run worker
 *
 * What it does:
 *   - reconcile entitlements, every RECONCILE_INTERVAL_MS (default 5 minutes)
 *   - enforce stream limits, every ENFORCE_INTERVAL_MS (default 20 seconds)
 *   - refresh the recently-added cache, every 10 minutes
 *   - prune expired sessions and dead invite links, hourly
 */

const RECONCILE_MS = env.RECONCILE_INTERVAL_MS;
const ENFORCE_MS = env.ENFORCE_INTERVAL_MS;
const PRUNE_MS = 60 * 60 * 1000;
/** New films land a few times a day. Ten minutes is far more often than they arrive. */
const RECENTLY_ADDED_MS = 10 * 60 * 1000;

let running = true;

async function main() {
  // Refuse to start production with half its credentials. A worker that boots without Plex
  // configured will happily "reconcile" everybody to no Plex access at all.
  assertProductionIntegrations();

  // Email is a WARNING here, not a refusal. Missing it means password reset is broken, which
  // is bad — but refusing to start would stop reconciliation entirely, and a service that
  // silently stops healing entitlements is far worse than one that cannot send a reset link.
  try {
    assertEmailConfigured();
  } catch (err) {
    console.warn(`  WARNING: ${err instanceof Error ? err.message : err}`);
  }

  console.log(
    [
      "",
      "  CineVault worker",
      `  reconcile every ${Math.round(RECONCILE_MS / 1000)}s`,
      `  prune sessions every ${Math.round(PRUNE_MS / 60000)}m`,
      `  recently added every ${Math.round(RECENTLY_ADDED_MS / 60000)}m`,
      `  stream limits every ${Math.round(ENFORCE_MS / 1000)}s` +
        (env.ENFORCE_STREAM_LIMITS ? "" : "  (DRY RUN — set ENFORCE_STREAM_LIMITS=true to act)"),
      `  plex: ${plexConfigured() ? "configured" : "NOT configured (shares will be skipped)"}`,
      "",
    ].join("\n")
  );

  // Run once at boot rather than waiting out the first interval. A deploy is precisely when
  // events were most likely to have been missed.
  await safely("reconcile", runReconcile);

  await safely("recently-added", runRecentlyAdded);

  const reconcileTimer = setInterval(() => void safely("reconcile", runReconcile), RECONCILE_MS);
  const pruneTimer = setInterval(() => void safely("prune", runPrune), PRUNE_MS);
  const recentTimer = setInterval(
    () => void safely("recently-added", runRecentlyAdded),
    RECENTLY_ADDED_MS
  );
  const enforceTimer = setInterval(() => void safely("enforce", runEnforce), ENFORCE_MS);

  const stop = (signal: string) => {
    if (!running) return;
    running = false;

    console.log(`\n  ${signal} received, stopping`);
    clearInterval(reconcileTimer);
    clearInterval(pruneTimer);
    clearInterval(recentTimer);
    clearInterval(enforceTimer);

    // Close the pool so the process actually exits rather than hanging on an open connection
    // and being SIGKILLed by the orchestrator thirty seconds later.
    void pool.end().finally(() => process.exit(0));
  };

  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}

async function runReconcile() {
  const result = await reconcileAll();

  // Only worth a line when something happened or something broke. A loop that logs "checked
  // 12, changed 0" every five minutes forever trains you to ignore its output, which is the
  // opposite of what a log is for.
  if (result.changed > 0 || result.failed > 0) {
    console.log(
      `  reconcile: ${result.checked} checked, ${result.changed} changed, ${result.failed} failed (${result.durationMs}ms)`
    );
  }
}

async function runRecentlyAdded() {
  const result = await refreshRecentlyAdded();
  if (result.items > 0) console.log(`  recently added: ${result.items} item(s) cached`);
}

async function runEnforce() {
  const result = await enforceStreamLimits();

  // Silent when nothing happened. This runs every twenty seconds, and a line each time saying
  // "2 streams, nobody over" is how you stop reading the log at all.
  if (result.terminated > 0 || result.wouldTerminate > 0) {
    console.log(
      `  enforce: ${result.terminated} stopped, ${result.wouldTerminate} would have been` +
        ` (${result.sessions} streams, ${result.overLimit} over limit)`
    );
  }
}

async function runPrune() {
  // Sessions and unconfirmed signups are Supabase's problem now — its own retention rules
  // handle them, and we do not maintain either table any more.
  //
  // Cosmetic, and deliberately hourly rather than urgent: an out-of-date invite already stops
  // working and already stops holding a slot the moment its timestamp passes. This only makes
  // the list say "Expired" rather than "Waiting" next to a date in the past.
  const expired = await sweepExpiredLinks();
  if (expired > 0) console.log(`  expired ${expired} referral link(s)`);

  // Clears out invites that died without anybody using them. Used ones are kept forever —
  // they are the record of a real referral — and the ledger is never touched at all.
  const purged = await purgeDeadLinks();
  if (purged > 0) console.log(`  purged ${purged} dead referral link(s)`);
}

/**
 * Run a task, and never let it kill the loop.
 *
 * An unhandled rejection inside a setInterval callback takes down the process, and a worker
 * that dies on one bad pass stops healing anything at all. Failures are logged and the next
 * tick tries again.
 */
async function safely(name: string, task: () => Promise<void>): Promise<void> {
  if (!running) return;

  try {
    await task();
  } catch (err) {
    console.error(`  ${name} threw:`, err instanceof Error ? err.message : err);
    await logError(
      `worker task "${name}" threw`,
      { error: err instanceof Error ? err.message : String(err) },
      { actor: "reconciler" }
    ).catch(() => {
      // Even the audit write failed. The console line above is all we have; carry on.
    });
  }
}

main().catch(async (err) => {
  console.error("\n  worker failed to start:", err instanceof Error ? err.message : err, "\n");
  await pool.end().catch(() => {});
  process.exit(1);
});
