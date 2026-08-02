import { z } from "zod";
import { apiUser } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { logError } from "@/lib/events";
import { PlexLinkError, pollLink, startLink, unlink } from "@/lib/plex/linking";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Plex linking.
 *
 * The user comes from the SESSION, never the request body. If the client could name the
 * account, anyone could unlink somebody else's Plex or attach their own to another person's
 * subscription.
 */

const ACTIONS = new Set(["link", "poll", "unlink"]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ action?: string[] }> }
) {
  const auth = await apiUser();
  if (!auth.ok) return auth.response;

  const { action } = await params;
  const verb = action?.[0];

  if (!verb || !ACTIONS.has(verb)) {
    return Response.json({ error: "unknown action" }, { status: 404 });
  }

  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "not signed in" }, { status: 401 });

  try {
    switch (verb) {
      case "link": {
        // Each PIN is a request to plex.tv. Someone hammering this would burn our rate limit
        // there and break linking for everybody, not just themselves.
        const limit = rateLimit(`plex:link:${user.id}`, 10, 10 * 60 * 1000);
        if (!limit.allowed) {
          return Response.json(
            { error: "Too many attempts. Wait a few minutes." },
            { status: 429 }
          );
        }

        return Response.json(await startLink());
      }

      case "poll": {
        const parsed = z
          .object({ pinId: z.coerce.number().int().positive() })
          .safeParse(await request.json().catch(() => ({})));

        if (!parsed.success) {
          return Response.json({ error: "pinId required" }, { status: 400 });
        }

        return Response.json(await pollLink(user, parsed.data.pinId));
      }

      case "unlink": {
        await unlink(user);
        return Response.json({ ok: true });
      }
    }
  } catch (err) {
    // A link refusal is the member's to see and act on (wrong account, already taken), not a
    // server error to bury.
    if (err instanceof PlexLinkError) {
      return Response.json({ error: err.message }, { status: 409 });
    }

    await logError(
      `plex/${verb} failed`,
      { error: err instanceof Error ? err.message : String(err) },
      { userId: user.id, email: user.email, plexUsername: user.plexUsername, actor: "user" }
    );

    return Response.json({ error: "That didn't work. Try again." }, { status: 502 });
  }

  return Response.json({ error: "unknown action" }, { status: 404 });
}
