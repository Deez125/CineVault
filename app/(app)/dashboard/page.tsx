import Link from "next/link";
import type { Metadata } from "next";
import { and, eq, isNull, lte, or, gte } from "drizzle-orm";
import { Gift, LayoutGrid, Info, Sparkles } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PageHeader } from "@/components/app/page-header";
import { ServerCard } from "@/components/app/server-card";
import { db } from "@/lib/db";
import { announcements } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { requireUser } from "@/lib/auth";
import { emailVerificationRequired } from "@/lib/email";

export const metadata: Metadata = { title: "Overview" };

export default async function DashboardPage() {
  await requireUser("/dashboard");
  const user = await getCurrentUser();
  if (!user) return null;

  const notices = await activeAnnouncements();

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        icon={LayoutGrid}
        title="Overview"
        subtitle="Your access at a glance"
      />

      <div className="space-y-5">
        {notices.map((notice) => (
          <Alert key={notice.id}>
            <Info />
            <AlertTitle>{notice.title}</AlertTitle>
            {notice.body && <AlertDescription>{notice.body}</AlertDescription>}
          </Alert>
        ))}

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
    </div>
  );
}

/**
 * Announcements that should be showing right now.
 *
 * A null start or end means "no bound", so a notice with neither is simply on until it is
 * turned off. Filtered in SQL rather than in JS so an old announcement never briefly renders
 * before being removed.
 */
async function activeAnnouncements() {
  const now = new Date();

  return db
    .select()
    .from(announcements)
    .where(
      and(
        eq(announcements.active, true),
        or(isNull(announcements.startsAt), lte(announcements.startsAt, now)),
        or(isNull(announcements.endsAt), gte(announcements.endsAt, now))
      )
    )
    .limit(5);
}
