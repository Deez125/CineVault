import { apiUser } from "@/lib/auth";
import { checkoutStatus } from "@/lib/stripe/checkout";
import { isEntitling } from "@/lib/stripe/client";
import { applyEntitlement } from "@/lib/entitlements";
import { logError } from "@/lib/events";

/**
 * Ask STRIPE whether a subscription actually went active.
 *
 * The success page must never conclude "you paid" because the browser arrived at a URL. A
 * redirect proves nothing and anyone can type it. This asks the only party that knows.
 */
export async function GET(request: Request) {
  const auth = await apiUser();
  if (!auth.ok) return auth.response;

  const subscriptionId = new URL(request.url).searchParams.get("subscriptionId");
  if (!subscriptionId) {
    return Response.json({ error: "subscriptionId required" }, { status: 400 });
  }

  try {
    const result = await checkoutStatus(subscriptionId);

    // The subscription must belong to whoever is asking, or this endpoint becomes a way to
    // probe other people's billing by guessing ids.
    if (result.userId && result.userId !== auth.user.id) {
      return Response.json({ error: "not found" }, { status: 404 });
    }

    // Settle entitlement here rather than waiting only on the webhook.
    //
    // The webhook is still the authority and still runs; this is a second door to the same
    // room, and applyEntitlement is idempotent so both arriving changes nothing. It matters
    // because the webhook can be late, and it can be absent entirely — in development nobody
    // is running `stripe listen`, so a payment would succeed, the billing page would read
    // "Active" straight from Stripe, and is_member would stay false forever. Plex and
    // Referrals then never appear and nothing ever fixes it.
    //
    // This does NOT trust the browser: applyEntitlement re-reads the subscription from Stripe
    // and grants only what Stripe says is paid for. Being asked is not being told.
    if (isEntitling(result.status)) {
      await applyEntitlement(auth.user.id, { actor: "user" }).catch(async (err) => {
        await logError("could not settle entitlement after checkout", {
          error: err instanceof Error ? err.message : String(err),
          subscriptionId,
        });
        return null;
      });
    }

    return Response.json({ status: result.status });
  } catch {
    return Response.json({ error: "could not read subscription" }, { status: 502 });
  }
}
