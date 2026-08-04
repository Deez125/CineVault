import { z } from "zod";
import { apiUser } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { tierForPrice } from "@/lib/stripe/tiers";
import { quoteCheckout } from "@/lib/stripe/checkout";
import { logError } from "@/lib/events";

/**
 * What starting this plan would cost today, before anything is created.
 *
 * Read-only by design. The checkout dialog asks this first so it knows whether a card is
 * needed at all — when account credit covers the whole first invoice, creating a subscription
 * would activate it immediately, and doing that just because somebody opened a dialog would
 * subscribe them and spend their credit before they pressed anything.
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

  // The price must be one of OURS, exactly as in the checkout route. A quote for an arbitrary
  // price would leak what else lives in the Stripe account.
  const tier = await tierForPrice(parsed.data.priceId);
  if (!tier) return Response.json({ error: "unknown plan" }, { status: 400 });

  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "not signed in" }, { status: 401 });

  if (user.isAdmin) {
    return Response.json(
      { error: "Admin accounts already have full access. There's nothing to buy." },
      { status: 409 }
    );
  }

  try {
    return Response.json(await quoteCheckout(user, tier.priceId));
  } catch (err) {
    await logError("checkout quote failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: "Could not work out the price." }, { status: 502 });
  }
}
