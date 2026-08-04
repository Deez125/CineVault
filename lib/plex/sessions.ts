import { env } from "@/lib/env";
import { serverJson, serverUri, forgetServerUri } from "./server";
import { plexHeaders } from "./client";

/**
 * What is playing right now, and stopping it.
 *
 * These talk to the SERVER, not to plex.tv. plex.tv knows who you have shared with; only the
 * server knows what is on screen this second.
 */

export type PlexSession = {
  /** What `terminate` takes. A client session identifier, not a number. */
  sessionId: string;
  /**
   * Increments per session on the server, so a higher one started later. Used to decide
   * which stream is "newest" — Plex does not report a start time on a session, and viewOffset
   * is how far INTO the film they are, which is a different thing entirely and would call a
   * resumed film "old".
   */
  sessionKey: number;
  /** Plex account id. Matches users.plex_user_id. */
  userId: string;
  username: string | null;
  /** "playing" | "paused" | "buffering" */
  state: string;
  /** For the log line, so a terminated stream can be recognised afterwards. */
  title: string | null;
  device: string | null;
};

type RawSession = {
  sessionKey?: string | number;
  title?: string;
  grandparentTitle?: string;
  Session?: { id?: string };
  User?: { id?: string | number; title?: string };
  Player?: { state?: string; title?: string; product?: string };
};

/** Everything currently streaming. */
export async function listSessions(): Promise<PlexSession[]> {
  const data = await serverJson<{ MediaContainer?: { Metadata?: RawSession[] } }>(
    "/status/sessions"
  );

  const rows = data.MediaContainer?.Metadata ?? [];

  return rows.flatMap((s) => {
    const sessionId = s.Session?.id;
    const userId = s.User?.id;

    // Both are required to act. A session we cannot name or cannot attribute is one we must
    // not count against anybody, let alone terminate.
    if (!sessionId || userId === undefined || userId === null) return [];

    return [
      {
        sessionId: String(sessionId),
        sessionKey: Number(s.sessionKey ?? 0),
        userId: String(userId),
        username: s.User?.title ?? null,
        state: s.Player?.state ?? "unknown",
        // Series name where there is one, so a log line says "The Bear" rather than
        // "Episode 3".
        title: s.grandparentTitle ?? s.title ?? null,
        device: s.Player?.title ?? s.Player?.product ?? null,
      },
    ];
  });
}

/**
 * Stop a stream, with a message the viewer sees on their device.
 *
 * Plex answers this on the SERVER over a plain GET, and returns 200 whether or not the
 * session still existed — a stream that ended a second before we asked is already the outcome
 * we wanted.
 */
export async function terminateSession(sessionId: string, reason: string): Promise<void> {
  const base = await serverUri();

  const url = new URL(`${base}/status/sessions/terminate`);
  url.searchParams.set("sessionId", sessionId);
  url.searchParams.set("reason", reason);

  const res = await fetch(url, {
    headers: plexHeaders(env.PLEX_TOKEN),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    // The address may have moved. Drop the cached one so the next attempt rediscovers it
    // rather than retrying somewhere that is no longer listening.
    forgetServerUri();
    throw new Error(`plex terminate failed: ${res.status}`);
  }
}
