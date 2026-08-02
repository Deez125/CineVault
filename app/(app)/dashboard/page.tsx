import Link from "next/link";
import type { Metadata } from "next";
import { Gift, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { ServerCard } from "@/components/app/server-card";
import { Announcements } from "@/components/app/announcements";
import { listForUser } from "@/lib/announcements";
import { getCurrentUser } from "@/lib/auth/session";
import { requireUser } from "@/lib/auth";
import { emailVerificationRequired } from "@/lib/email";

export const metadata: Metadata = { title: "Overview" };

export default async function DashboardPage() {
  await requireUser("/dashboard");
  const user = await getCurrentUser();
  if (!user) return null;

  // Both halves: what is showing, and what they have closed but can still get back to.
  const notices = await listForUser(user.id);

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Your access at a glance"
      />

      <div className="space-y-5">
        <Announcements visible={notices.visible} dismissed={notices.dismissed} />

        {/* Recently added lives here, as a poster strip. Deliberately a visible placeholder
            rather than a hidden section: the space it will occupy is part of the layout, and
            leaving it out would mean rearranging this page again later. */}
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Recently added
            </h2>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-dashed bg-card/50 px-5 py-8 text-sm text-muted-foreground">
            <Sparkles className="size-4 shrink-0" />
            New films and episodes will appear here once the library feed is connected.
          </div>
        </section>

        <ServerCard user={user} />

        <div className="flex items-center gap-3 rounded-xl border border-dashed bg-card/50 px-5 py-4 text-sm text-muted-foreground">
          <Gift className="size-4 shrink-0" />
          <span>
            Referrals are coming: invite a friend, get credit on your next bill.
          </span>
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
