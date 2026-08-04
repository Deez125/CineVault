import { apiUser, apiMember } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { logError } from "@/lib/events";
import { PlexLinkError, unlink } from "@/lib/plex/linking";

export async function POST() {
  const auth = await apiUser();
  if (!auth.ok) return auth.response;

  const member = await apiMember();
  if (!member.ok) return member.response;

  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "not signed in" }, { status: 401 });

  try {
    await unlink(user);
    return Response.json({ ok: true });
  } catch (err) {
    // A failed revoke is the member's to see: nothing was changed, and trying again in a
    // moment is the right next step.
    if (err instanceof PlexLinkError) {
      return Response.json({ error: err.message }, { status: 409 });
    }

    await logError(
      "plex unlink failed",
      { error: err instanceof Error ? err.message : String(err) },
      { userId: user.id, email: user.email, plexUsername: user.plexUsername, actor: "user" }
    );

    return Response.json({ error: "That didn't work. Try again." }, { status: 502 });
  }
}
