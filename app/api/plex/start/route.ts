import { NextResponse } from "next/server";
import { apiMember } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { logError } from "@/lib/events";
import { PlexLinkError, startLink } from "@/lib/plex/linking";
import { setLinkTicketOnResponse } from "@/lib/plex/link-ticket";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Send the member to Plex to sign in.
 *
 * Mints a PIN, remembers it in a signed cookie bound to this user, and redirects to Plex's
 * own hosted sign-in. They come back to /api/plex/callback.
 *
 * WHY THIS USES NextResponse.redirect DIRECTLY (not `redirect()` from next/navigation):
 * `cookies().set()` + `redirect()` looks fine in isolation but breaks in prod once the root
 * middleware is also in play — the middleware prepares its own NextResponse via
 * NextResponse.next(), and cookies written to the request-scoped jar don't reliably attach
 * to the redirect response Next builds when the route handler throws NEXT_REDIRECT.
 * Setting the cookie on a response we own removes the ambiguity.
 */
export async function GET(request: Request) {
  const member = await apiMember();
  if (!member.ok) return member.response;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login?next=/dashboard/plex", env.APP_URL));
  }

  // Each attempt is a request to plex.tv. Somebody hammering this would burn our rate limit
  // there and break linking for everyone, not only themselves.
  const limit = rateLimit(`plex:link:${user.id}`, 10, 10 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.redirect(new URL("/dashboard/plex?error=rate_limited", env.APP_URL));
  }

  try {
    const { pinId, authUrl } = await startLink(`${env.APP_URL}/api/plex/callback`);

    // Build the redirect and attach the ticket cookie to IT, so the browser reliably has it
    // when Plex sends the visitor back to /api/plex/callback.
    const response = NextResponse.redirect(authUrl);
    setLinkTicketOnResponse(response, pinId, user.id);
    return response;
  } catch (err) {
    if (err instanceof PlexLinkError) {
      return NextResponse.redirect(new URL("/dashboard/plex?error=unavailable", env.APP_URL));
    }

    await logError(
      "plex link start failed",
      { error: err instanceof Error ? err.message : String(err) },
      { userId: user.id, email: user.email, actor: "user" }
    );
    return NextResponse.redirect(new URL("/dashboard/plex?error=failed", env.APP_URL));
  }
}
