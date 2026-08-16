import { apiAdmin } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { env, plexConfigured } from "@/lib/env";
import { serverJson } from "@/lib/plex/server";
import { listSessions } from "@/lib/plex/sessions";

/**
 * Admin-only diagnostic: what /status/sessions returns vs what we stored as your plexUserId.
 *
 * Exists because the sessions panel came up empty for the server owner and the two most
 * likely reasons — Plex reporting a different User.id than we saved on linking, or the
 * account not being linked at all — are invisible from the UI. This spells both out so a
 * mismatch can be corrected without shell access to prod.
 */
export async function GET() {
  const auth = await apiAdmin();
  if (!auth.ok) return auth.response;
  if (!plexConfigured()) return Response.json({ error: "plex not configured" }, { status: 404 });

  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "not found" }, { status: 404 });

  // Raw dump of what Plex reports on this session's User element, per session, without any
  // of our normalisation. The parsed version is included alongside so we can spot cases
  // where our normalisation itself is dropping something.
  let raw: unknown;
  let parsed;
  try {
    raw = await serverJson<unknown>("/status/sessions");
    parsed = await listSessions();
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }

  // Pull just the User + Session + Player.title so the payload is small and readable in the
  // browser. Full sessions live in `raw` for the whole picture.
  const rawContainer = raw as {
    MediaContainer?: { Metadata?: Array<Record<string, unknown>> };
  };
  const rawSessions = (rawContainer.MediaContainer?.Metadata ?? []).map((s) => {
    const plexUser = (s.User ?? null) as { id?: unknown; title?: unknown } | null;
    const session = (s.Session ?? null) as { id?: unknown } | null;
    const player = (s.Player ?? null) as { title?: unknown; product?: unknown } | null;
    return {
      title: s.title,
      grandparentTitle: s.grandparentTitle,
      type: s.type,
      sessionId: session?.id ?? null,
      "User.id": plexUser?.id ?? null,
      "User.id type":
        plexUser?.id === undefined || plexUser?.id === null ? "absent" : typeof plexUser.id,
      "User.title": plexUser?.title ?? null,
      player: player?.title ?? player?.product ?? null,
    };
  });

  const parsedForCompare = parsed.map((p) => ({
    sessionId: p.sessionId,
    userId: p.userId,
    "userId type": p.userId === null ? "null" : typeof p.userId,
    title: p.title,
    matches: p.userId !== null && p.userId === user.plexUserId,
  }));

  return Response.json({
    you: {
      email: user.email,
      plexUsername: user.plexUsername,
      plexUserId: user.plexUserId,
      "plexUserId type": user.plexUserId === null ? "null" : typeof user.plexUserId,
      isAdmin: user.isAdmin,
    },
    plex: { machineId: env.PLEX_MACHINE_ID },
    rawSessions,
    parsedForCompare,
    // Full raw response last so it does not push the useful bit off screen.
    rawFull: raw,
  });
}

export const dynamic = "force-dynamic";
