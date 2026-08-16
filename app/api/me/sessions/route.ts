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
 * Only the caller's OWN streams are returned — matched by their linked Plex userId. Nobody
 * else's titles, devices, or usernames leak sideways. This applies to admins too: even the
 * server owner sees only what THEY are playing, not what other people on the server are up
 * to. If an owner wants the server-wide view, that lives in Plex's own dashboard, not here.
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

  // Without a linked Plex account there is no possible match, so no need to hit Plex.
  // Answering empty rather than fetching-and-filtering to nothing keeps the request cheap
  // and stops us leaking that the Plex server is reachable to accounts that shouldn't care.
  if (!user.plexUserId && !user.plexUsername) {
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

  // Two ways to attribute a session to this member:
  //
  //  a) userId match — the normal case. Every ordinary member's playback comes with their
  //     plex.tv account id, which is what pollLink stored on their row.
  //  b) username match — the server-owner quirk. Plex reports the OWNER's own playback with
  //     User.id="1" (the local-admin sentinel) rather than their plex.tv id, so the id
  //     comparison never matches. User.title still carries the owner's real Plex username,
  //     which pollLink also stored, and Plex usernames are globally unique on the platform.
  //
  // Both fields come from linking, so a member who has never linked hits neither branch and
  // sees nothing, which is correct.
  const wantedUsername = user.plexUsername?.toLowerCase() ?? null;
  const mySessions = all.filter((s) => {
    if (s.userId !== null && user.plexUserId !== null && s.userId === user.plexUserId) {
      return true;
    }
    if (wantedUsername && s.username && s.username.toLowerCase() === wantedUsername) {
      return true;
    }
    return false;
  });

  const body: MySessionsResponse = {
    mySessions,
    allowance: { used: mySessions.length, limit: user.streamLimit },
  };

  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
