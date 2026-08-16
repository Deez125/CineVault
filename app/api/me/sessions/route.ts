import { apiMember } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { plexConfigured } from "@/lib/env";
import { listSessions, type PlexSession } from "@/lib/plex/sessions";
import { logError } from "@/lib/events";

/**
 * What the SIGNED-IN MEMBER is watching right now, live.
 *
 * The panel on /dashboard/plex polls this every few seconds to update the "x/y streams" count
 * and redraw the session cards. Two important constraints shape this route:
 *
 *  1. **Nobody sees anyone else.** The Plex server exposes every stream on it to whoever
 *     asks; we filter to only the caller's own userId and expose nothing else. No usernames,
 *     no titles, no devices belonging to anyone besides them.
 *
 *  2. **Never blank on transient failure.** A Plex hiccup between polls should NOT clear the
 *     panel — the client keeps the previous frame if we answer 503 with an empty payload, so
 *     the UI stays quiet rather than flashing "0 streams" every time the server takes an
 *     extra second to respond.
 */

export type MySessionsResponse = {
  mySessions: PlexSession[];
  allowance: { used: number; limit: number };
};

export async function GET() {
  const auth = await apiMember();
  if (!auth.ok) return auth.response;

  if (!plexConfigured()) return new Response(null, { status: 404 });

  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "not found" }, { status: 404 });

  // A member without a linked Plex account has zero streams by definition. Answer with an
  // empty list rather than fetching sessions we would immediately filter to nothing — cheaper
  // and it also stops us leaking the fact that the Plex server is reachable.
  if (!user.plexUserId) {
    const body: MySessionsResponse = {
      mySessions: [],
      allowance: { used: 0, limit: user.streamLimit },
    };
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  }

  let all;
  try {
    all = await listSessions();
  } catch (err) {
    // Keep the current frame on the client rather than clobbering it with an empty one. 503
    // is deliberately distinguishable from a real "nothing playing" (200 with empty array).
    void logError("could not list plex sessions for /api/me/sessions", {
      error: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: "upstream unavailable" }, { status: 503 });
  }

  const mySessions = all.filter((s) => s.userId === user.plexUserId);

  const body: MySessionsResponse = {
    mySessions,
    allowance: { used: mySessions.length, limit: user.streamLimit },
  };

  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
