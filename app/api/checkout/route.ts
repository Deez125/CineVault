import { z } from "zod";
import { apiUser } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { AlreadySubscribedError, BannedError, startCheckout } from "@/lib/stripe/checkout";
import { tierForPrice } from "@/lib/stripe/tiers";
import { logError } from "@/lib/events";

/**
 * Start a checkout.
 *
 * The user comes from the SESSION, never from the request body. If the client could name the
 * customer, anyone could start a subscription against someone else's Stripe customer, or
 * manipulate their billing.
 */
export async function POST(request: Request) {
  const auth = await apiUser();
  if (!auth.ok) return auth.response;

  const parsed = z
    .object({ priceId: z.string().min(1) })
    .safeParse(await request.json().catch(() => ({})));

  if (!parsed.success) {
    return Response.json({ error: "priceId required" }, { status: 400 });
  }

  // The price must be one of OURS. Without this check, a crafted request could subscribe
  // someone to any price in the Stripe account, including a $0 one.
  const tier = await tierForPrice(parsed.data.priceId);
  if (!tier) {
    return Response.json({ error: "unknown plan" }, { status: 400 });
  }

  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "not signed in" }, { status: 401 });

  try {
    const intent = await startCheckout(user, tier.priceId);
    return Response.json(intent);
  } catch (err) {
    if (err instanceof AlreadySubscribedError) {
      return Response.json({ error: err.message, code: err.code }, { status: 409 });
    }
    if (err instanceof BannedError) {
      return Response.json({ error: err.message, code: err.code }, { status: 403 });
    }

    await logError(
      "checkout failed",
      { error: err instanceof Error ? err.message : String(err) },
      { userId: user.id, email: user.email, actor: "user" }
    );

    return Response.json({ error: "Could not start checkout. Try again." }, { status: 502 });
  }
}
