import { getCurrentUser } from "@/lib/auth/session";
import { debugAllowed } from "@/lib/debug";
import { stripe } from "@/lib/stripe/client";
import { plexConfigured, tracearrConfigured } from "@/lib/env";

/**
 * What the system currently believes about the signed-in user.
 *
 * Reads Stripe LIVE rather than trusting our own columns. The whole reason to look at a debug
 * panel is that you suspect the cache is wrong, so a panel that renders the cache back at you
 * would agree with the bug.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!debugAllowed(user)) return Response.json({ error: "not found" }, { status: 404 });
  if (!user) return Response.json({ error: "not found" }, { status: 404 });

  let stripeSubscriptions: { id: string; status: string; amount: number; cancelAtPeriodEnd: boolean }[] = [];
  let stripeError: string | null = null;

  if (user.stripeCustomerId) {
    try {
      const list = await stripe.subscriptions.list({
        customer: user.stripeCustomerId,
        status: "all",
        limit: 20,
      });
      stripeSubscriptions = list.data.map((s) => ({
        id: s.id,
        status: s.status,
        amount: s.items.data[0]?.price?.unit_amount ?? 0,
        cancelAtPeriodEnd: s.cancel_at_period_end,
      }));
    } catch (err) {
      stripeError = err instanceof Error ? err.message : String(err);
    }
  }

  return Response.json({
    db: {
      id: user.id,
      email: user.email,
      isAdmin: user.isAdmin,
      banned: user.banned,
      emailVerified: Boolean(user.emailVerifiedAt),
      isMember: user.isMember,
      streamLimit: user.streamLimit,
      subStatus: user.subStatus,
      subAmount: user.subAmount,
      cancelAtPeriodEnd: user.subCancelAtPeriodEnd,
      currentPeriodEnd: user.subCurrentPeriodEnd,
      stripeCustomerId: user.stripeCustomerId,
      stripeSubscriptionId: user.stripeSubscriptionId,
      plexUsername: user.plexUsername,
      plexUserId: user.plexUserId,
      shareState: user.shareState,
    },
    stripe: { subscriptions: stripeSubscriptions, error: stripeError },
    integrations: {
      plex: plexConfigured(),
      tracearr: tracearrConfigured(),
      webhook: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    },
  });
}
