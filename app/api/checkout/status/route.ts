import { apiUser } from "@/lib/auth";
import { checkoutStatus } from "@/lib/stripe/checkout";

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

    return Response.json({ status: result.status });
  } catch {
    return Response.json({ error: "could not read subscription" }, { status: 502 });
  }
}
