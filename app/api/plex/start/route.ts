import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { logError } from "@/lib/events";
import { PlexLinkError, startLink } from "@/lib/plex/linking";
import { setLinkTicket } from "@/lib/plex/link-ticket";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Send the member to Plex to sign in.
 *
 * Mints a PIN, remembers it in a signed cookie bound to this user, and redirects to Plex's
 * own hosted sign-in. They come back to /api/plex/callback.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/dashboard/plex");

  // Each attempt is a request to plex.tv. Somebody hammering this would burn our rate limit
  // there and break linking for everyone, not only themselves.
  const limit = rateLimit(`plex:link:${user.id}`, 10, 10 * 60 * 1000);
  if (!limit.allowed) {
    redirect("/dashboard/plex?error=rate_limited");
  }

  let destination: string;

  try {
    const { pinId, authUrl } = await startLink(`${env.APP_URL}/api/plex/callback`);
    await setLinkTicket(pinId, user.id);
    destination = authUrl;
  } catch (err) {
    if (err instanceof PlexLinkError) redirect("/dashboard/plex?error=unavailable");

    await logError(
      "plex link start failed",
      { error: err instanceof Error ? err.message : String(err) },
      { userId: user.id, email: user.email, actor: "user" }
    );
    redirect("/dashboard/plex?error=failed");
  }

  // Outside the try: redirect() works by throwing, so calling it inside would be caught by
  // our own catch and reported as a failure.
  redirect(destination);
}
