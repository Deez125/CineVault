import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { logError } from "@/lib/events";
import { PlexLinkError, pollLink } from "@/lib/plex/linking";
import { clearLinkTicket, readLinkTicket } from "@/lib/plex/link-ticket";

/**
 * Where Plex sends the member back after they sign in.
 *
 * Redeems the PIN for their identity, records it, and provisions. Then bounces to the Plex
 * page with a result, so the outcome is visible rather than silent.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/dashboard/plex");

  const pinId = await readLinkTicket(user.id);
  await clearLinkTicket();

  if (!pinId) {
    // No ticket, expired, or belonging to somebody else. Nothing to redeem.
    redirect("/dashboard/plex?error=expired");
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

  // Outside the try: redirect() throws to do its work, so it must not be inside a catch.
  redirect(`/dashboard/plex${outcome}`);
}
