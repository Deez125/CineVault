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

  // ── Extended fields for the member-facing "live sessions" panel ────────────
  // The enforcer never reads any of these — they exist so /api/me/sessions can render a
  // rich card without a second Plex fetch.

  /** "episode" | "movie" | "clip" | etc. Drives whether we show S/E or a year. */
  mediaType: string | null;
  /**
   * Show name for episodes, otherwise null. `title` still holds the episode name (or the
   * movie title, for movies), so the two together give "Show / Episode".
   */
  showTitle: string | null;
  /** Season and episode numbers, for episodes. */
  seasonNumber: number | null;
  episodeNumber: number | null;
  /** Release year, for movies. */
  year: number | null;
  /**
   * Plex-side artwork paths. Not URLs — these are relative paths passed through the
   * /api/plex/image proxy so the Plex token never reaches the browser.
   */
  thumbPath: string | null;
  artPath: string | null;
  /** Playback progress in milliseconds. Both are populated when the player has loaded. */
  positionMs: number | null;
  durationMs: number | null;
  /** e.g. "1080", "4k", "720". Verbatim from Plex — normalised at render. */
  resolution: string | null;
  /** True when the server is transcoding video for this session. */
  transcoding: boolean;
  /** Reported IP of the player, for a "local network" vs "external" note in the panel. */
  playerAddress: string | null;
};

type RawSession = {
  type?: string;
  sessionKey?: string | number;
  title?: string;
  grandparentTitle?: string;
  parentIndex?: number;
  index?: number;
  year?: number;
  thumb?: string;
  grandparentThumb?: string;
  art?: string;
  viewOffset?: number;
  duration?: number;
  Session?: { id?: string };
  User?: { id?: string | number; title?: string };
  Player?: {
    state?: string;
    title?: string;
    product?: string;
    address?: string;
    remotePublicAddress?: string;
  };
  Media?: Array<{ videoResolution?: string }>;
  TranscodeSession?: { videoDecision?: string } | null;
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

    const isEpisode = s.type === "episode";

    // For the LOG line title we still prefer the show name — the enforcer wants "The Bear"
    // not "Episode 3". For the panel, showTitle + title are kept separate so the UI can
    // render "Show / Episode" and lay them out however it wants.
    const logTitle = s.grandparentTitle ?? s.title ?? null;

    // Prefer episode-still for episodes (which is thumb), fall back to show art
    // (grandparentThumb). Movies use their own thumb.
    const thumbPath = isEpisode ? s.thumb ?? s.grandparentThumb ?? null : s.thumb ?? null;

    // Plex reports videoDecision on TranscodeSession as "transcode" / "copy" / "direct play".
    // Presence of a TranscodeSession alone means SOME conversion is happening (audio, subs,
    // container), but the panel only calls out video-transcoding — the case that costs real
    // server CPU.
    const transcoding = s.TranscodeSession?.videoDecision === "transcode";

    return [
      {
        sessionId: String(sessionId),
        sessionKey: Number(s.sessionKey ?? 0),
        userId: String(userId),
        username: s.User?.title ?? null,
        state: s.Player?.state ?? "unknown",
        title: logTitle,
        device: s.Player?.title ?? s.Player?.product ?? null,

        mediaType: s.type ?? null,
        // For an episode, `title` from the panel's perspective is the EPISODE name; the show
        // goes into showTitle.
        showTitle: isEpisode ? s.grandparentTitle ?? null : null,
        seasonNumber: isEpisode ? s.parentIndex ?? null : null,
        episodeNumber: isEpisode ? s.index ?? null : null,
        year: !isEpisode && typeof s.year === "number" ? s.year : null,
        thumbPath,
        artPath: s.art ?? null,
        positionMs: typeof s.viewOffset === "number" ? s.viewOffset : null,
        durationMs: typeof s.duration === "number" ? s.duration : null,
        resolution: s.Media?.[0]?.videoResolution ?? null,
        transcoding,
        playerAddress: s.Player?.remotePublicAddress ?? s.Player?.address ?? null,
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
