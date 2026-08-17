import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, desc, eq } from "drizzle-orm";
import {
  ArrowLeft,
  Ban,
  BellDot,
  CheckCircle,
  CircleAlert,
  CircleDashed,
  Clock,
  Play,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { events, userActivity, users } from "@/lib/db/schema";
import { getUser } from "@/lib/admin";
import { listAllNotifications } from "@/lib/notifications";
import { fetchCustomerCreditCents } from "@/lib/admin/profile-actions";
import { displayName } from "@/lib/display-name";
import { formatMoney } from "@/lib/money";
import { formatStreamLimit, isUnlimited } from "@/lib/plans";
import { cn } from "@/lib/utils";
import { ProfileActionsBar } from "./profile-actions-bar";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "User" };

/**
 * Everything the admin might want to know about one member, plus the buttons to act on it.
 *
 * The page is composed of several small sections rather than one big card:
 *   - Header with identity + badges (admin/member/banned)
 *   - Subscription + credit block (from Stripe live, joined against our sub cache)
 *   - Plex + activity block (from our cache — no per-render Plex call)
 *   - Admin action bar — award credit / set balance
 *   - Recent notifications the admin has fired at this user
 *   - Recent audit-log events on this account
 *
 * Everything reads server-side. Only the action bar is interactive; the dialogs it opens
 * post to /admin/profile/[uuid]/actions.ts.
 */
export default async function ProfilePage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  await requireAdmin();

  const { uuid } = await params;
  const user = await getUser(uuid);
  if (!user) notFound();

  // Everything below in parallel — none of it depends on anything else.
  const [creditBalanceCents, activity, notifications, recentEvents] = await Promise.all([
    // Credit balance: cheap, one API call. Wrapped so a Stripe hiccup doesn't 500 the whole
    // page — the section falls back to "unavailable".
    user.stripeCustomerId
      ? fetchCustomerCreditCents(user.stripeCustomerId).catch(() => null)
      : Promise.resolve(0),

    db
      .select({ lastWatchedAt: userActivity.lastWatchedAt, updatedAt: userActivity.updatedAt })
      .from(userActivity)
      .where(eq(userActivity.userId, user.id))
      .limit(1)
      .then((rows) => rows[0] ?? null),

    listAllNotifications(user.id),

    // The last dozen events specifically about this user. We deliberately narrow by userId
    // rather than showing the global feed — a per-user audit view has a very different job
    // than the admin activity feed.
    db
      .select()
      .from(events)
      .where(and(eq(events.userId, user.id)))
      .orderBy(desc(events.id))
      .limit(12),
  ]);

  return (
    <>
      <div className="mb-3">
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Back to users
        </Link>
      </div>

      <PageHeader
        title={displayName(user) ?? user.email}
        subtitle={user.email}
      />

      {/* Badges strip — quick answer to "what is this account?" */}
      <div className="mb-5 flex flex-wrap gap-2">
        {user.isAdmin && <Badge tone="primary" icon={<ShieldCheck className="size-3" />}>Admin</Badge>}
        {user.banned && <Badge tone="destructive" icon={<Ban className="size-3" />}>Banned</Badge>}
        {user.isMember ? (
          <Badge tone="success" icon={<CheckCircle className="size-3" />}>Member</Badge>
        ) : (
          <Badge tone="muted" icon={<CircleDashed className="size-3" />}>No plan</Badge>
        )}
        {user.plexUsername ? (
          <Badge tone="muted">Plex: {user.plexUsername}</Badge>
        ) : (
          <Badge tone="warning">Plex not linked</Badge>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* ── Subscription + credit ─────────────────────────────────────────── */}
        <section className="overflow-hidden rounded-xl border bg-card lg:col-span-2">
          <div className="border-b px-5 py-3.5">
            <h2 className="text-sm font-semibold">Subscription</h2>
          </div>
          <dl className="divide-y">
            <Row label="Plan">
              {user.isMember ? (
                <span className="font-medium">{formatStreamLimit(user.streamLimit)}</span>
              ) : (
                <span className="text-muted-foreground">None</span>
              )}
              {isUnlimited(user.streamLimit) && (
                <span className="ml-2 text-xs text-muted-foreground">(admin)</span>
              )}
            </Row>
            <Row label="Status">
              {statusPill(user.subStatus, user.subCancelAtPeriodEnd)}
            </Row>
            <Row label="Amount">
              {user.subAmount !== null ? (
                <span className="font-medium tabular-nums">
                  {formatMoney(user.subAmount, user.subCurrency ?? "usd")}
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    / {user.subInterval ?? "month"}
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </Row>
            <Row label="Current period ends">
              {user.subCurrentPeriodEnd ? (
                <span>{user.subCurrentPeriodEnd.toLocaleDateString()}</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </Row>
            <Row label="Credit balance">
              {creditBalanceCents === null ? (
                <span className="text-muted-foreground">Couldn&apos;t reach Stripe.</span>
              ) : (
                <span
                  className={cn(
                    "flex items-center gap-1 font-medium tabular-nums",
                    creditBalanceCents > 0 && "text-success"
                  )}
                >
                  <Wallet className="size-3.5" />
                  {formatMoney(creditBalanceCents)}
                </span>
              )}
            </Row>
            <Row label="Stripe customer">
              {user.stripeCustomerId ? (
                <a
                  href={`https://dashboard.stripe.com/customers/${user.stripeCustomerId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs text-primary underline-offset-2 hover:underline"
                >
                  {user.stripeCustomerId}
                </a>
              ) : (
                <span className="text-muted-foreground">Never had one</span>
              )}
            </Row>
          </dl>
        </section>

        {/* ── Plex + activity ───────────────────────────────────────────────── */}
        <section className="overflow-hidden rounded-xl border bg-card">
          <div className="border-b px-5 py-3.5">
            <h2 className="text-sm font-semibold">Plex &amp; activity</h2>
          </div>
          <dl className="divide-y">
            <Row label="Plex username">
              {user.plexUsername ? (
                <span className="font-medium">{user.plexUsername}</span>
              ) : (
                <span className="text-muted-foreground">Not linked</span>
              )}
            </Row>
            <Row label="Plex user id">
              {user.plexUserId ? (
                <span className="font-mono text-xs">{user.plexUserId}</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </Row>
            <Row label="Share state">
              <span className="text-sm">{user.shareState}</span>
            </Row>
            <Row label="Last watched">
              {activity?.lastWatchedAt ? (
                <span className="flex items-center gap-1">
                  <Play className="size-3.5 text-muted-foreground" />
                  {activity.lastWatchedAt.toLocaleString()}
                </span>
              ) : activity ? (
                <span className="text-muted-foreground">Never</span>
              ) : (
                <span className="text-muted-foreground">Not cached yet</span>
              )}
            </Row>
            <Row label="Account created">
              <span>{user.createdAt.toLocaleDateString()}</span>
            </Row>
          </dl>
        </section>
      </div>

      {/* ── Admin actions ─────────────────────────────────────────────────── */}
      <section className="mt-5 overflow-hidden rounded-xl border bg-card">
        <div className="border-b px-5 py-3.5">
          <h2 className="text-sm font-semibold">Take an action</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Anything you do here fires a notification on their dashboard.
          </p>
        </div>
        <ProfileActionsBar
          userId={user.id}
          userEmail={user.email}
          hasStripeCustomer={Boolean(user.stripeCustomerId)}
          currentCreditCents={creditBalanceCents ?? 0}
        />
      </section>

      {/* ── Notifications history ──────────────────────────────────────────── */}
      <section className="mt-5 overflow-hidden rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <div className="flex items-center gap-2">
            <BellDot className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Notifications sent to this user</h2>
          </div>
          <span className="text-xs text-muted-foreground">{notifications.length}</span>
        </div>
        {notifications.length === 0 ? (
          <div className="px-5 py-6 text-sm text-muted-foreground">
            Nothing sent yet.
          </div>
        ) : (
          <ul className="divide-y">
            {notifications.map((n) => (
              <li key={n.id} className="flex items-start gap-3 px-5 py-3">
                <NotificationDot severity={n.severity} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium">{n.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {n.readAt ? "read " : ""}
                      {(n.readAt ?? n.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {n.body && <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>}
                </div>
                {n.readAt ? (
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    read
                  </span>
                ) : (
                  <span className="text-[10px] uppercase tracking-wider text-warning">unread</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Recent audit events on this user ──────────────────────────────── */}
      <section className="mt-5 overflow-hidden rounded-xl border bg-card">
        <div className="border-b px-5 py-3.5">
          <h2 className="text-sm font-semibold">Recent activity on this account</h2>
        </div>
        {recentEvents.length === 0 ? (
          <div className="px-5 py-6 text-sm text-muted-foreground">
            No events on file.
          </div>
        ) : (
          <ul className="divide-y">
            {recentEvents.map((e) => (
              <li key={e.id} className="flex items-start gap-3 px-5 py-3 text-sm">
                <Clock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p>{e.message}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {e.actor} · {e.ts.toLocaleString()}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

// ── small pieces ────────────────────────────────────────────────────────────

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function Badge({
  children,
  icon,
  tone,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  tone: "primary" | "success" | "warning" | "destructive" | "muted";
}) {
  const tones = {
    primary: "bg-primary/10 text-primary ring-primary/25",
    success: "bg-success/10 text-success ring-success/25",
    warning: "bg-warning/10 text-warning ring-warning/25",
    destructive: "bg-destructive/10 text-destructive ring-destructive/25",
    muted: "bg-muted text-muted-foreground ring-border",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        tones[tone]
      )}
    >
      {icon}
      {children}
    </span>
  );
}

function statusPill(status: string | null, cancelling: boolean) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  const label = cancelling ? "Cancelling" : status;
  const tone: "success" | "warning" | "destructive" | "muted" =
    cancelling ? "warning" : status === "active" ? "success" : status === "past_due" ? "warning" : status === "canceled" ? "destructive" : "muted";
  return <Badge tone={tone}>{label}</Badge>;
}

function NotificationDot({ severity }: { severity: string }) {
  const tone =
    severity === "success"
      ? "bg-success"
      : severity === "warning"
        ? "bg-warning"
        : "bg-primary";
  return <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", tone)} aria-hidden />;
}
