import { apiMember } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { plexConfigured } from "@/lib/env";
import { listSessions, type PlexSession } from "@/lib/plex/sessions";
import { logError } from "@/lib/events";

/**
 * What the SIGNED-IN MEMBER is watching right now, live.
 *
 * The panel on /dashboard/plex polls this every few seconds to update the "x/y streams" count
 * and redraw the session cards.
 *
 * Two audiences with different views of the same data:
 *
 *  - **Members** see ONLY their own streams (filtered by Plex userId). Nobody else's titles,
 *    devices, or usernames leak sideways.
 *
 *  - **Admins** see every session on the server, including those Plex reports with no User
 *    element attached — which is common for the owner's own playback. Filtering an admin
 *    by their linked plexUserId would drop exactly the sessions they most want to see (their
 *    own), and would also drop everyone else's, which is the wrong direction: the server
 *    owner already sees all playback in Plex's own dashboard, so surfacing it here is only
 *    convenience, not new access.
 *
 * On a Plex hiccup between polls we return 503; the client keeps its previous frame rather
 * than flashing "0 streams" every time the server takes an extra second to respond.
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

  // A non-admin member without a linked Plex account has zero streams by definition. Answer
  // with an empty list rather than fetching sessions we would immediately filter to nothing —
  // cheaper, and it also stops us leaking the fact that the Plex server is reachable.
  // Admins are exempt because they see everything regardless of whether they linked.
  if (!user.isAdmin && !user.plexUserId) {
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

  // Admins get everything on the server (their own playback included, whether Plex attached
  // a User id to it or not). Members get only their own attributed sessions.
  const mySessions = user.isAdmin
    ? all
    : all.filter((s) => s.userId !== null && s.userId === user.plexUserId);

  const body: MySessionsResponse = {
    mySessions,
    allowance: { used: mySessions.length, limit: user.streamLimit },
  };

  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
