import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Gift } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { ServerCard } from "@/components/app/server-card";
import { Announcements } from "@/components/app/announcements";
import { RecentlyAdded } from "@/components/app/recently-added";
import { readRecentlyAdded } from "@/lib/plex/recently-added-cache";
import { listForUser } from "@/lib/announcements";
import { getCurrentUser } from "@/lib/auth/session";
import { requireUser } from "@/lib/auth";
import { emailVerificationRequired } from "@/lib/email";
import { formatMoney } from "@/lib/stripe/client";
import { REFERRAL_REWARD } from "@/lib/referrals";

export const metadata: Metadata = { title: "Overview" };

export default async function DashboardPage() {
  await requireUser("/dashboard");
  const user = await getCurrentUser();
  if (!user) return null;

  // Notices: both halves, what is showing and what they have closed but can get back to.
  // Recently added is read from the cache the worker fills, never fetched from Plex here.
  const [notices, recent] = await Promise.all([listForUser(user.id), readRecentlyAdded()]);

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Your access at a glance"
      />

      <div className="space-y-5">
        <Announcements visible={notices.visible} dismissed={notices.dismissed} />

        <section>
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Recently added
            </h2>
            <span className="text-xs text-muted-foreground">
              Across the shared libraries
            </span>
          </div>
          <RecentlyAdded items={recent} />
        </section>

        <ServerCard user={user} />

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card px-5 py-4">
          <Gift className="size-4 shrink-0 text-success" />
          <span className="text-sm">
            Invite a friend, get {formatMoney(REFERRAL_REWARD)} off your next bill.
          </span>
          <Link
            href="/dashboard/referrals"
            className="ml-auto inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            How it works
            <ArrowRight className="size-3.5" />
          </Link>
        </div>

        {emailVerificationRequired() && !user.emailVerifiedAt && (
          <p className="text-center text-xs text-muted-foreground">
            Your email isn&apos;t confirmed yet.{" "}
            <Link href="/dashboard/settings" className="underline underline-offset-2">
              Resend the link
            </Link>
          </p>
        )}
      </div>
    </>
  );
}
