import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { requireAdmin } from "@/lib/auth";
import { getLiveMetrics } from "@/lib/analytics/stripe-live";
import { readLatestSnapshot, readRecentSnapshots } from "@/lib/analytics/snapshot";
import { listCosts, totalActiveMonthlyCents } from "@/lib/analytics/costs";
import { listDormantSubscribers } from "@/lib/analytics/dormant";
import { NowSection } from "./sections/now-section";
import { ProfitSection } from "./sections/profit-section";
import { CostsSection } from "./sections/costs-section";
import { TrendsSection } from "./sections/trends-section";
import { DormantSection } from "./sections/dormant-section";
import { TopTranscodersPlaceholder } from "./sections/top-transcoders-placeholder";

export const metadata: Metadata = { title: "Analytics" };

// The analytics page is a fresh read of live Stripe every request (cached in-process for
// a minute — see stripe-live.ts). Never prerendered — the numbers change by the second
// and a stale build would be actively misleading.
export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  await requireAdmin();

  // Fetch everything in parallel. Nothing here depends on anything else:
  //   - live metrics come from Stripe
  //   - snapshots come from our own table
  //   - costs, dormant come from our own tables
  // Rendering waits on the slowest (Stripe), and a failure in one doesn't block the others.
  const [live, latestSnapshot, recentSnapshots, costs, monthlyCostCents, dormant] =
    await Promise.all([
      getLiveMetrics().catch(() => null),
      readLatestSnapshot(),
      readRecentSnapshots(30),
      listCosts(),
      totalActiveMonthlyCents(),
      listDormantSubscribers(),
    ]);

  return (
    <>
      <PageHeader title="Analytics" subtitle="How the business is doing" />

      <div className="space-y-5">
        <NowSection live={live} />

        <ProfitSection
          mrrCents={live?.mrrCents ?? 0}
          nextMonthCents={live?.nextMonthCents ?? 0}
          monthlyCostCents={monthlyCostCents}
        />

        <CostsSection costs={costs} />

        <TrendsSection latest={latestSnapshot} history={recentSnapshots} />

        <DormantSection rows={dormant} />

        <TopTranscodersPlaceholder />
      </div>
    </>
  );
}
