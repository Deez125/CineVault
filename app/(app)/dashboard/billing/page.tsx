import type { Metadata } from "next";
import { CreditCard } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { PlanChooser } from "./plan-chooser";
import { BillingClient } from "./billing-client";
import { requireUser } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { getTiers } from "@/lib/stripe/tiers";
import { getSubscriptionDetail } from "@/lib/stripe/subscription";

export const metadata: Metadata = { title: "Billing" };

export default async function BillingPage() {
  await requireUser("/dashboard/billing");
  const user = await getCurrentUser();
  if (!user) return null;

  const tiers = await getTiers().catch(() => []);
  const subscription = user.stripeCustomerId
    ? await getSubscriptionDetail(user).catch(() => null)
    : null;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        icon={CreditCard}
        title="Billing"
        subtitle={subscription ? "Your plan, card and receipts" : "Choose a plan to get started"}
      />

      {subscription ? (
        <BillingClient initial={subscription} tiers={tiers} />
      ) : (
        <PlanChooser tiers={tiers} />
      )}
    </div>
  );
}
