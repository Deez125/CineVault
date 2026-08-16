"use client";

import { useMemo, useState } from "react";
import { Timer, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import type { LiveMetrics, SubscriptionDetail } from "@/lib/analytics/stripe-live";
import { SubscriptionsDialog, type CardKey } from "./subscriptions-dialog";

/**
 * The eight clickable stat cards + the breakdown dialog they open.
 *
 * Each card is a button. Clicking one sets `openCard` to that card's key; the shared
 * <SubscriptionsDialog> filters the subscription details for that card and renders the
 * breakdown. One dialog for all cards so state doesn't fragment across eight copies.
 */

export function NowSectionClient({ live }: { live: LiveMetrics | null }) {
  const [openCard, setOpenCard] = useState<CardKey | null>(null);

  // Hoisted above the early-null-return so it runs on every render — Rules of Hooks. The
  // filter itself no-ops when openCard is null (empty array), so this is essentially free
  // until a card is actually clicked.
  const detailsForCard = useMemo(
    () => filterDetails(live?.details ?? [], openCard),
    [live, openCard]
  );

  if (!live) return null;

  const projectionDelta = live.thisMonthCents - live.nextMonthCents;
  const projectionTone: "default" | "warning" =
    projectionDelta > 0 ? "warning" : "default";

  return (
    <section className="space-y-4">
      {/* ── Revenue right now ──────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatButton
          onClick={() => setOpenCard("mrr")}
          label="MRR"
          value={formatMoney(live.mrrCents)}
          hint={`ARPU ${formatMoney(live.arpuCents)}`}
        />
        <StatButton
          onClick={() => setOpenCard("this-month")}
          label="This month"
          value={formatMoney(live.thisMonthCents)}
          hint="Booked, including cancels at period end"
        />
        <StatButton
          onClick={() => setOpenCard("next-month")}
          label="Next month"
          value={formatMoney(live.nextMonthCents)}
          hint={
            projectionDelta > 0
              ? `Down ${formatMoney(projectionDelta)} — cancelling subs`
              : "Same as this month"
          }
          tone={projectionTone}
        />
        <StatButton
          onClick={() => setOpenCard("at-risk")}
          label="At risk"
          value={formatMoney(live.atRiskMrrCents)}
          hint="Past-due subs — recoverable if dunning succeeds"
          tone={live.atRiskMrrCents > 0 ? "warning" : "default"}
        />
      </div>

      {/* ── Members right now ──────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatButton
          onClick={() => setOpenCard("active")}
          label="Active subs"
          value={live.activeSubscribers}
          hint={live.trialingSubscribers > 0 ? `+${live.trialingSubscribers} trialing` : undefined}
        />
        <StatButton
          onClick={() => setOpenCard("cancelling")}
          label="Cancelling"
          value={live.cancellingSubscribers}
          hint={
            live.cancellingSubscribers > 0
              ? `${formatMoney(live.cancellingMrrCents)} leaves at renewal`
              : "Nobody scheduled to cancel"
          }
          tone={live.cancellingSubscribers > 0 ? "warning" : "default"}
        />
        <StatButton
          onClick={() => setOpenCard("past-due")}
          label="Past due"
          value={live.pastDueSubscribers}
          tone={live.pastDueSubscribers > 0 ? "warning" : "default"}
        />
        <StatButton
          onClick={() => setOpenCard("trialing")}
          label="Trialing"
          value={live.trialingSubscribers}
        />
      </div>

      {/* ── Tier breakdown, when there's more than one ─────────────────────── */}
      {live.byTier.length > 1 && (
        <div className="rounded-xl border bg-card p-5">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            By tier
          </h3>
          <ul className="mt-3 divide-y">
            {live.byTier.map((t) => (
              <li key={t.streamLimit} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                <div className="flex items-center gap-2">
                  <Users className="size-3.5 text-muted-foreground" />
                  <span className="font-medium">{tierLabel(t.streamLimit)}</span>
                  <span className="text-muted-foreground">
                    · {t.count} member{t.count === 1 ? "" : "s"}
                  </span>
                </div>
                <span className="font-medium tabular-nums">{formatMoney(t.mrrCents)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        <Timer className="mr-1 inline size-3" />
        Live from Stripe, cached in-process for up to a minute. Last read{" "}
        {formatShortTime(live.fetchedAt)}. Click any card above for the per-subscription
        breakdown.
      </p>

      <SubscriptionsDialog
        card={openCard}
        onOpenChange={(open) => !open && setOpenCard(null)}
        details={detailsForCard}
      />
    </section>
  );
}

/** Slice the shared details list for the currently-open card. */
function filterDetails(
  details: SubscriptionDetail[],
  card: CardKey | null
): SubscriptionDetail[] {
  if (!card) return [];
  switch (card) {
    case "mrr":
    case "this-month":
    case "active":
      return details.filter((d) => d.status === "active" || d.status === "past_due");
    case "next-month":
      return details.filter(
        (d) => (d.status === "active" || d.status === "past_due") && !d.cancelAtPeriodEnd
      );
    case "at-risk":
    case "past-due":
      return details.filter((d) => d.status === "past_due");
    case "cancelling":
      return details.filter(
        (d) => (d.status === "active" || d.status === "past_due") && d.cancelAtPeriodEnd
      );
    case "trialing":
      return details.filter((d) => d.status === "trialing");
  }
}

// ── card button ─────────────────────────────────────────────────────────────

function StatButton({
  onClick,
  label,
  value,
  hint,
  tone = "default",
}: {
  onClick: () => void;
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "warning" | "success" | "destructive";
}) {
  const tones = {
    default: "",
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group rounded-xl border bg-card p-5 text-left transition-colors",
        "hover:border-primary/30 hover:bg-muted/40 focus-visible:border-primary/50 focus-visible:outline-none",
        "cursor-pointer"
      )}
    >
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={cn("mt-1.5 text-2xl font-semibold tabular-nums", tones[tone])}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </button>
  );
}

function tierLabel(streamLimit: number): string {
  if (streamLimit <= 0) return "Unknown tier";
  return `${streamLimit} stream${streamLimit === 1 ? "" : "s"}`;
}

function formatShortTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
