// Deliberately NOT marked `server-only`: transitively imported by lib/analytics/dormant.ts,
// which the background worker loads. `server-only` throws in every non-RSC caller.

import { serverJson } from "@/lib/plex/server";

/**
 * Fetch the most recent playback timestamp for a single Plex account.
 *
 * `/status/sessions/history/all` returns every completed play across the server. Passing
 * `accountID={id}` filters to one user; asking for one row (`X-Plex-Container-Size=1`) and
 * sorting descending gives us the latest without pulling their whole history.
 *
 * Returns null when the account has no history at all — which is "never watched" for the
 * dormant panel, a distinct bucket from "watched a long time ago". Also returns null on any
 * Plex error rather than throwing, because the nightly refresher walks EVERY member and one
 * upstream hiccup shouldn't kill the whole pass; the caller decides whether to leave the
 * previous cached value in place or clear it.
 */
export async function fetchLastWatchedAt(plexAccountId: string): Promise<Date | null> {
  try {
    const data = await serverJson<{
      MediaContainer?: { Metadata?: Array<{ viewedAt?: number }> };
    }>(`/status/sessions/history/all?accountID=${encodeURIComponent(plexAccountId)}` +
      `&sort=viewedAt:desc` +
      `&X-Plex-Container-Size=1`);

    const first = data.MediaContainer?.Metadata?.[0];
    const viewedAt = first?.viewedAt;
    if (typeof viewedAt !== "number") return null;

    // Plex reports viewedAt as unix seconds. JS wants ms.
    return new Date(viewedAt * 1000);
  } catch {
    // Silent by design — the caller logs the aggregate outcome. A one-line error per user
    // in a fleet of hundreds turns the log into noise nobody reads.
    return null;
  }
}

/**
 * Fetch a user's transcode count over the last N days.
 *
 * Reserved for the top-transcoders panel. Not called anywhere yet, but the wire fits with
 * fetchLastWatchedAt so the same nightly pass can populate both columns of user_activity in
 * one visit per user.
 */
export async function countTranscodesSince(
  plexAccountId: string,
  since: Date
): Promise<number> {
  try {
    const sinceUnix = Math.floor(since.getTime() / 1000);
    const data = await serverJson<{
      MediaContainer?: {
        Metadata?: Array<{ viewedAt?: number }>;
      };
    }>(`/status/sessions/history/all?accountID=${encodeURIComponent(plexAccountId)}` +
      `&viewedAt>=${sinceUnix}` +
      `&X-Plex-Container-Size=0` +
      `&X-Plex-Container-Start=0`);

    // We're only after the count for now; history rows on Plex don't expose
    // `transcode_decision` the way live sessions do (that lives on the session itself, not
    // the played-back record). Until we're capturing transcode events during playback and
    // storing them, this returns total plays — an upper bound the transcoder-panel UI can
    // reveal as "recent plays" instead of "transcodes" if we ship it before the capture
    // side.
    return data.MediaContainer?.Metadata?.length ?? 0;
  } catch {
    return 0;
  }
}
