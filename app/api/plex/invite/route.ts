import { apiMember } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { getShareState } from "@/lib/plex/share";
import { logError } from "@/lib/events";

/**
 * Has this member accepted their Plex invite yet?
 *
 * Asked of Plex on every call rather than cached. The answer changes the moment they click
 * accept in another tab, and a stale "still waiting" would leave somebody staring at a button
 * they no longer need.
 *
 * Deliberately slow-ish (it lists the server's shares) and deliberately not called on every
 * page load — the Plex page asks once, after linking.
 */
export async function GET() {
  const member = await apiMember();
  if (!member.ok) return member.response;

  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "not signed in" }, { status: 401 });

  // Nothing to check before they have told us who they are on Plex.
  if (!user.plexUsername && !user.plexEmail) {
    return Response.json({ state: "none" });
  }

  try {
    return Response.json({ state: await getShareState(user) });
  } catch (err) {
    await logError(
      "could not check the Plex invite",
      { error: err instanceof Error ? err.message : String(err) },
      { userId: user.id, email: user.email, plexUsername: user.plexUsername, actor: "user" }
    );

    // 200 with an explicit "unknown". A failed CHECK is not a failed invite, and the page
    // should say it could not tell rather than claim the invite is missing.
    return Response.json({ state: "unknown" });
  }
}
