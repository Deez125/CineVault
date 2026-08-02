import type { Metadata } from "next";

import { PageHeader } from "@/components/app/page-header";
import { PlanChooser } from "./plan-chooser";
import { BillingClient } from "./billing-client";
import { FinishingCheckout } from "./finishing-checkout";
import { requireUser } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { getTiers } from "@/lib/stripe/tiers";
import { getSubscriptionDetail } from "@/lib/stripe/subscription";

export const metadata: Metadata = { title: "Billing" };

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ price?: string; checkout?: string }>;
}) {
  await requireUser("/dashboard/billing");
  const user = await getCurrentUser();
  if (!user) return null;

  const params = await searchParams;

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
        <PlanChooser tiers={tiers} preselect={params.price} />
      )}
    </>
  );
}
