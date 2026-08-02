import { getCurrentUser } from "@/lib/auth/session";
import { debugAllowed } from "@/lib/debug";
import { applyEntitlement } from "@/lib/entitlements";
import { logEvent, logError } from "@/lib/events";
import { terminateAllSubscriptions } from "@/lib/stripe/subscription";

/**
 * End the subscription NOW, not at the end of the paid period.
 *
 * The ordinary cancel path deliberately runs to the end of what someone already paid for.
 * This is the other one: for testing, and for the times an admin needs somebody off
 * immediately.
 *
 * It cancels in Stripe and then runs applyEntitlement, rather than clearing our own flags.
 * Stripe is the source of truth, so the only honest way to remove access is to remove the
 * thing that grants it and let the one door follow. Pulling the Plex share while the
 * subscription stayed live would achieve nothing at all: the next reconcile would see a
 * paying customer and re-invite them within five minutes.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!debugAllowed(user)) return Response.json({ error: "not found" }, { status: 404 });
  if (!user) return Response.json({ error: "not found" }, { status: 404 });

  try {
    const terminated = await terminateAllSubscriptions(user);

    // Runs even when nothing was cancelled: the point is to end up consistent with Stripe,
    // and "there was nothing live" is a state worth reconciling to as well.
    const result = await applyEntitlement(user.id, { actor: `admin:${user.id}` });

    await logEvent({
      type: "admin_action",
      severity: "warn",
      actor: `admin:${user.id}`,
      userId: user.id,
      email: user.email,
      plexUsername: user.plexUsername,
      message: `${user.email} terminated their subscription from the debug panel`,
      detail: { terminated },
    });

    return Response.json({
      ok: true,
      terminated,
      isMember: result?.isMember ?? false,
      streamLimit: result?.streamLimit ?? 0,
    });
  } catch (err) {
    await logError(
      "debug terminate failed",
      { error: err instanceof Error ? err.message : String(err) },
      { userId: user.id, email: user.email, actor: `admin:${user.id}` }
    );
    return Response.json({ error: "Couldn't terminate. Check the logs." }, { status: 502 });
  }
}
