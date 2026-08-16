import { isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { adminEmails, env, plexConfigured } from "@/lib/env";
import { isProtected } from "@/lib/plex/protected";
import { isUnlimited, overLimit } from "@/lib/plans";
import { listSessions, terminateSession, type PlexSession } from "@/lib/plex/sessions";
import { logEvent, logError } from "@/lib/events";

/**
 * Stream limits.
 *
 * A plan buys a number of things playing at once. This is the loop that makes that true.
 *
 * IT IS THE MOST DESTRUCTIVE THING IN THE CODEBASE. Everything else here either grants
 * access or writes a row; this one stops a paying customer's film mid-scene. So it is built
 * to do nothing in every case where it is not certain:
 *
 *   - It is OFF unless ENFORCE_STREAM_LIMITS says otherwise. With it off the loop still runs
 *     and still logs what it WOULD have killed, so the behaviour can be watched against real
 *     traffic before it is trusted with it.
 *   - If Plex cannot be reached, it enforces NOTHING. An unreachable server is not evidence
 *     that somebody is over their limit; it is evidence we cannot tell.
 *   - Sessions it cannot attribute to one of our members are ignored entirely.
 *   - Protected users and admins are never touched, the same rail that guards sharing.
 *   - Nobody is killed on first sight of being over. See the grace period below.
 */

/**
 * How many consecutive checks somebody must be over their limit before anything is stopped.
 *
 * Two, so a member has to be over for a whole poll interval before we act.
 *
 * This is not politeness, it is correctness. Plex keeps a finished session in its list for
 * up to a minute — walk from the TV to the phone and for a moment you are "watching" on both.
 * Killing on first sight would end the phone stream, because the phone is the NEWER one, and
 * the ghost on the TV would survive. Waiting one interval lets the ghost disappear on its
 * own, and the count drops back with nobody touched.
 *
 * Somebody genuinely stacking streams gets an extra ENFORCE_INTERVAL_MS. That costs nothing.
 */
const STRIKES_BEFORE_ACTING = 2;

/**
 * Consecutive over-limit observations, by our user id.
 *
 * In memory, and deliberately so: it is worth nothing after a restart, and a restart handing
 * everybody a fresh grace period is the safe direction to be wrong in. A table would make
 * this durable and the durability would only ever hurt somebody.
 */
const strikes = new Map<string, number>();

export type EnforceResult = {
  sessions: number;
  checked: number;
  overLimit: number;
  terminated: number;
  wouldTerminate: number;
  skipped: boolean;
  durationMs: number;
};

/**
 * Plex, injectable.
 *
 * The real functions are the defaults and production never passes anything. It exists so the
 * decision logic — who is over, which stream dies, when the grace period fires — can be tested
 * exhaustively against invented sessions. The alternative is testing the most destructive code
 * here by terminating real streams on a real server, which is not a test anybody should run
 * twice.
 */
export type EnforceDeps = {
  listSessions?: () => Promise<PlexSession[]>;
  terminateSession?: (sessionId: string, reason: string) => Promise<void>;
};

export async function enforceStreamLimits(deps: EnforceDeps = {}): Promise<EnforceResult> {
  const readSessions = deps.listSessions ?? listSessions;
  const stopSession = deps.terminateSession ?? terminateSession;

  const started = Date.now();
  const idle: EnforceResult = {
    sessions: 0,
    checked: 0,
    overLimit: 0,
    terminated: 0,
    wouldTerminate: 0,
    skipped: true,
    durationMs: 0,
  };

  if (!plexConfigured()) return { ...idle, durationMs: Date.now() - started };

  let sessions: PlexSession[];
  try {
    sessions = await readSessions();
  } catch (err) {
    // Cannot see. Therefore cannot judge. Nothing is terminated on a guess.
    await logError("could not read Plex sessions; enforcing nothing this pass", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ...idle, durationMs: Date.now() - started };
  }

  if (sessions.length === 0) {
    strikes.clear();
    return { ...idle, skipped: false, durationMs: Date.now() - started };
  }

  // Group by Plex account. Paused counts — a paused stream still holds a slot, and treating
  // it as free would let somebody park one on every device.
  //
  // Unattributed sessions (null userId, which Plex sometimes reports for owner playbacks)
  // are skipped entirely: nobody to bill them against, and terminating a session we cannot
  // name would break the whole "never touch what you cannot verify" rail this file is built
  // around.
  const byPlexUser = new Map<string, PlexSession[]>();
  for (const s of sessions) {
    if (s.userId === null) continue;
    const list = byPlexUser.get(s.userId) ?? [];
    list.push(s);
    byPlexUser.set(s.userId, list);
  }

  const members = await db.select().from(users).where(isNotNull(users.plexUserId));
  const admins = adminEmails();

  let checked = 0;
  let over = 0;
  let terminated = 0;
  let wouldTerminate = 0;
  const seen = new Set<string>();

  for (const [plexUserId, theirs] of byPlexUser) {
    const member = members.find((m) => m.plexUserId === plexUserId);

    // Not one of ours. Somebody the server was shared with before this system existed, or the
    // owner's own playback. Not our business to police.
    if (!member) continue;

    if (isProtected(member.plexUsername)) continue;
    if (admins.includes(member.email.toLowerCase())) continue;
    if (isUnlimited(member.streamLimit)) continue;

    checked += 1;
    seen.add(member.id);

    if (!overLimit(theirs.length, member.streamLimit)) {
      // Back within their allowance — forgive the earlier strikes rather than remembering
      // them. Strikes must be CONSECUTIVE or they accumulate over an evening and eventually
      // fire at somebody doing nothing wrong.
      strikes.delete(member.id);
      continue;
    }

    over += 1;
    const count = (strikes.get(member.id) ?? 0) + 1;
    strikes.set(member.id, count);

    if (count < STRIKES_BEFORE_ACTING) continue;

    // Newest first. The stream that put them over the limit is the one that stops; the ones
    // already running are not interrupted.
    const excess = [...theirs]
      .sort((a, b) => b.sessionKey - a.sessionKey)
      .slice(0, theirs.length - member.streamLimit);

    for (const session of excess) {
      if (!env.ENFORCE_STREAM_LIMITS) {
        wouldTerminate += 1;
        console.log(
          `  [enforce] WOULD stop ${member.email} — ${theirs.length}/${member.streamLimit} streams` +
            ` (${session.title ?? "unknown"} on ${session.device ?? "unknown device"})`
        );
        continue;
      }

      try {
        await stopSession(
          session.sessionId,
          `You've reached your plan's limit of ${member.streamLimit} stream${member.streamLimit === 1 ? "" : "s"} at once. Stop another stream, or upgrade your plan at ${siteHost()}`
        );

        terminated += 1;

        await logEvent({
          type: "admin_action",
          severity: "warn",
          actor: "enforcer",
          userId: member.id,
          email: member.email,
          plexUsername: member.plexUsername,
          message: `stopped a stream for ${member.email} — ${theirs.length} running on a ${member.streamLimit}-stream plan`,
          detail: {
            limit: member.streamLimit,
            running: theirs.length,
            title: session.title,
            device: session.device,
            state: session.state,
          },
        });
      } catch (err) {
        await logError(
          "could not stop a stream",
          {
            error: err instanceof Error ? err.message : String(err),
            sessionId: session.sessionId,
          },
          { userId: member.id, email: member.email, actor: "enforcer" }
        );
      }
    }

    // Whether it worked or not, start the count again. A failed termination should get its
    // own grace period rather than retrying instantly in a tight loop.
    strikes.delete(member.id);
  }

  // Anybody who has stopped watching entirely drops out of the session list, so their strikes
  // would otherwise sit in the map forever and be waiting for them tomorrow.
  for (const id of strikes.keys()) {
    if (!seen.has(id)) strikes.delete(id);
  }

  return {
    sessions: sessions.length,
    checked,
    overLimit: over,
    terminated,
    wouldTerminate,
    skipped: false,
    durationMs: Date.now() - started,
  };
}

/**
 * Just the hostname, for the message Plex shows on the device.
 *
 * Derived from APP_URL rather than written out, so development says localhost and production
 * says the real domain — a hardcoded address would send anybody testing locally to the live
 * site. No scheme and no path: this lands as plain text on a TV, where nobody can click it
 * and a long URL is just noise to read back.
 */
function siteHost(): string {
  try {
    return new URL(env.APP_URL).host;
  } catch {
    return env.APP_URL;
  }
}

/** Testing seam. The strike map is process state, and a test must be able to start clean. */
export function resetStrikes(): void {
  strikes.clear();
}
