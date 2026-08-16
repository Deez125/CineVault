import { NextResponse } from "next/server";
import { apiMember } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { logError } from "@/lib/events";
import { PlexLinkError, pollLink } from "@/lib/plex/linking";
import { LINK_COOKIE_NAME, readLinkTicket } from "@/lib/plex/link-ticket";

/**
 * Where Plex sends the member back after they sign in.
 *
 * Redeems the PIN for their identity, records it, and provisions. Then bounces to the Plex
 * page with a result, so the outcome is visible rather than silent.
 *
 * Uses NextResponse.redirect and attaches the ticket-cookie CLEAR to that same response for
 * the same reason /api/plex/start uses it — cookie writes via cookies().set() don't
 * reliably survive the redirect once the root middleware is in play.
 */
export async function GET() {
  const member = await apiMember();
  if (!member.ok) return member.response;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login?next=/dashboard/plex", env.APP_URL));
  }

  const pinId = await readLinkTicket(user.id);

  if (!pinId) {
    // No ticket, expired, or belonging to somebody else. Nothing to redeem.
    return clearingRedirect("/dashboard/plex?error=expired");
  }

  let outcome: string;

  try {
    // Plex normally attaches the token before it forwards, but the two are not strictly
    // ordered, so give it a few tries rather than declaring failure on a race we can simply
    // wait out.
    let linked = false;

    for (let attempt = 0; attempt < 5 && !linked; attempt += 1) {
      const result = await pollLink(user, pinId);
      linked = result.linked;
      if (!linked) await new Promise((resolve) => setTimeout(resolve, 700));
    }

    outcome = linked ? "?linked=1" : "?error=not_authorised";
  } catch (err) {
    if (err instanceof PlexLinkError) {
      // A refusal the member needs to read: wrong account, already linked elsewhere.
      outcome = `?error=refused&message=${encodeURIComponent(err.message)}`;
    } else {
      await logError(
        "plex link callback failed",
        { error: err instanceof Error ? err.message : String(err) },
        { userId: user.id, email: user.email, actor: "user" }
      );
      outcome = "?error=failed";
    }
  }

  return clearingRedirect(`/dashboard/plex${outcome}`);
}

/**
 * Redirect to a path under APP_URL, clearing the plex-link ticket cookie on the way out.
 *
 * The ticket is single-use — whatever happened, we do not want it sitting in the browser
 * for a subsequent stray hit on this route.
 */
function clearingRedirect(path: string) {
  const response = NextResponse.redirect(new URL(path, env.APP_URL));
  response.cookies.delete(LINK_COOKIE_NAME);
  return response;
}
