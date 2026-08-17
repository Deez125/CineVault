import type { Metadata } from "next";
import { Gift } from "lucide-react";

import { PageHeader } from "@/components/app/page-header";
import { PlanChooser } from "./plan-chooser";
import { BillingClient } from "./billing-client";
import { FinishingCheckout } from "./finishing-checkout";
import { AdminPlan } from "./admin-plan";
import { requireUser } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { getTiers } from "@/lib/stripe/tiers";
import { getSubscriptionDetail } from "@/lib/stripe/subscription";
import { REFEREE_PERCENT_OFF, shouldDiscount } from "@/lib/referrals";

export const metadata: Metadata = { title: "Billing" };

// Live Stripe on every visit — same reason as /dashboard. Admin credit adjustments and
// discount changes need to show up immediately, and a cached render defeats that.
export const dynamic = "force-dynamic";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ price?: string; checkout?: string }>;
}) {
  await requireUser("/dashboard/billing");
  const user = await getCurrentUser();
  if (!user) return null;

  const params = await searchParams;

  // Admins do not buy anything, so none of the rest of this page applies to them — no
  // Stripe lookup, no tiers, no checkout to finish. Checked first so an admin who somehow
  // has an old subscription still sees the admin plan rather than a bill.
  if (user.isAdmin) {
    return (
      <>
        <PageHeader title="Billing" subtitle="Your plan" />
        <AdminPlan />
      </>
    );
  }

  const tiers = await getTiers().catch(() => []);
  const subscription = user.stripeCustomerId
    ? await getSubscriptionDetail(user).catch(() => null)
    : null;

  // Back from a 3DS challenge, but Stripe hasn't flipped the subscription yet. Neither the
  // plan chooser nor the billing panel is honest here — one implies they never paid, the
  // other implies they're set up. So: say what's actually happening and watch for it.
  if (!subscription && params.checkout) {
    return (
      <>
        <PageHeader title="Billing" subtitle="Finishing your payment" />
        <FinishingCheckout subscriptionId={params.checkout} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Billing"
        subtitle={subscription ? "Your plan, card and receipts" : "Choose a plan to get started"}
      />

      {subscription ? (
        <BillingClient initial={subscription} tiers={tiers} />
      ) : (
        <>
          {/* The prices below are the normal ones; Stripe applies the discount at the payment
              step. Saying so here stops the card totals looking like a mistake. */}
          {(await shouldDiscount(user.id)) && (
            <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-success/30 bg-success/5 p-4 text-sm">
              <Gift className="mt-0.5 size-4 shrink-0 text-success" />
              <span>
                You were invited, so your first month is {REFEREE_PERCENT_OFF}% off whichever plan
                you pick. The discount is applied at checkout.
              </span>
            </div>
          )}
          <PlanChooser tiers={tiers} preselect={params.price} />
        </>
      )}
    </>
  );
}
