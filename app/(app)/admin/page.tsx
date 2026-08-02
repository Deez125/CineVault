import Link from "next/link";
import type { Metadata } from "next";
import { TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { EventFeed } from "@/components/app/event-feed";
import { findDuplicatePlexAccounts, getStats } from "@/lib/admin";
import { listEvents } from "@/lib/events";
import { formatMoney } from "@/lib/stripe/client";
import { plexConfigured, tracearrConfigured } from "@/lib/env";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminOverviewPage() {
  const [stats, recent, duplicates] = await Promise.all([
    getStats(),
    listEvents({ limit: 15 }),
    findDuplicatePlexAccounts(),
  ]);

  // Things that are quietly broken and would otherwise only surface as a support ticket.
  const warnings: string[] = [];
  if (!env.STRIPE_WEBHOOK_SECRET) {
    warnings.push(
      "No Stripe webhook secret is set. Payments will succeed and nobody will be granted access."
    );
  }
  if (!plexConfigured()) {
    warnings.push("Plex is not configured. Nobody can be granted or revoked access.");
  }
  if (!tracearrConfigured()) {
    warnings.push("Tracearr is not configured. Stream limits are not being enforced.");
  }
  if (duplicates.length > 0) {
    warnings.push(
      `${duplicates.length} Plex account(s) are linked to more than one CineVault account.`
    );
  }

  return (
    <>
      <PageHeader title="Admin" subtitle="How the service is doing" />

      {warnings.length > 0 && (
        <Alert variant="destructive" className="mb-5">
          <TriangleAlert />
          <AlertDescription>
            <ul className="space-y-1">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Members"
          value={stats.members}
          hint={`${stats.total} account${stats.total === 1 ? "" : "s"} total`}
        />
        <StatCard
          label="Monthly revenue"
          value={formatMoney(stats.mrr, stats.currency)}
          hint={stats.cancelling > 0 ? `${stats.cancelling} cancelling` : "nobody cancelling"}
          tone={stats.cancelling > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Awaiting link"
          value={stats.awaitingLink}
          hint={stats.awaitingLink > 0 ? "paying, but can't watch" : "everyone's set up"}
          tone={stats.awaitingLink > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Errors (24h)"
          value={stats.errors24h}
          hint={stats.errors24h > 0 ? "check the activity log" : "all clear"}
          tone={stats.errors24h > 0 ? "destructive" : "success"}
        />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <section className="rounded-xl border bg-card xl:col-span-2">
          <div className="flex items-center justify-between gap-4 border-b px-5 py-3.5">
            <div>
              <h2 className="text-sm font-semibold">Recent activity</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Access changes, links, and errors
              </p>
            </div>
            <Button variant="ghost" size="sm" render={<Link href="/admin/activity" />}>
              View all
            </Button>
          </div>
          <EventFeed events={recent} empty="Nothing has happened yet." />
        </section>

        <section className="rounded-xl border bg-card">
          <div className="border-b px-5 py-3.5">
            <h2 className="text-sm font-semibold">At a glance</h2>
          </div>
          <dl className="divide-y text-sm">
            <Row label="Plex linked" value={`${stats.linked} of ${stats.total}`} />
            <Row label="Signups (7d)" value={String(stats.signups7d)} />
            <Row label="Banned" value={String(stats.banned)} />
            <Row label="Cancelling" value={String(stats.cancelling)} />
          </dl>
          <div className="border-t p-4">
            <Button variant="secondary" size="lg" className="w-full" render={<Link href="/admin/users" />}>
              Manage users
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-2.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
