import { Info, TrendingUp } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { MetricsSnapshot } from "@/lib/db/schema";

/**
 * Trends over the last month, from the snapshot table.
 *
 * Thin on day one — the snapshotter has to write a few days before there's anything to
 * plot. The empty state says exactly that rather than showing a flat line pretending it
 * is data.
 *
 * Two things get plotted:
 *
 *   1. MRR over time — a sparkline of `mrr_cents` per day. The width scales with the number
 *      of days we have, so a 3-day history doesn't stretch across the panel.
 *   2. Movement — a simple horizontal bar summing new + churned MRR across the range,
 *      colour-coded so a healthy month reads as more green than red.
 *
 * Churn rate is derived here rather than stored — churned_subscribers ÷ active_subscribers
 * at the start of the period, guarded against zero.
 */

export function TrendsSection({
  latest,
  history,
}: {
  latest: MetricsSnapshot | null;
  history: MetricsSnapshot[];
}) {
  if (!latest || history.length === 0) {
    return (
      <section className="rounded-xl border border-dashed bg-card/50 p-6 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Info className="size-4" />
          <span>
            No history yet. The snapshotter writes a row every night at 04:00 UTC — check
            back tomorrow for the first datapoint. In dry-run mode until{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">SNAPSHOT_DRY_RUN=false</code>.
          </span>
        </div>
      </section>
    );
  }

  // Newest-first from the reader. For plotting we want oldest-first so the line grows
  // left-to-right.
  const chronological = [...history].reverse();

  const totalNew = chronological.reduce((sum, s) => sum + s.newMrrCents, 0);
  const totalChurned = chronological.reduce((sum, s) => sum + s.churnedMrrCents, 0);
  const totalGainedSubs = chronological.reduce((sum, s) => sum + s.newSubscribers, 0);
  const totalLostSubs = chronological.reduce((sum, s) => sum + s.churnedSubscribers, 0);

  // Churn rate for the range: sum of churned_subscribers ÷ active_subscribers at range start.
  const startActive = chronological[0]?.activeSubscribers ?? 0;
  const customerChurnPct =
    startActive > 0 ? (totalLostSubs / startActive) * 100 : 0;

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-3 border-b px-5 py-3.5">
        <div>
          <h2 className="text-sm font-semibold">Trends</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Last {history.length} day{history.length === 1 ? "" : "s"} of snapshots.
          </p>
        </div>
        <TrendingUp className="size-4 text-muted-foreground" />
      </div>

      <div className="grid gap-px bg-border sm:grid-cols-3">
        <Cell label="Gained subs" value={`+${totalGainedSubs}`} hint={`${formatMoney(totalNew)} new MRR`} tone={totalGainedSubs > 0 ? "success" : "muted"} />
        <Cell label="Lost subs" value={`-${totalLostSubs}`} hint={`${formatMoney(totalChurned)} churned`} tone={totalLostSubs > 0 ? "warning" : "muted"} />
        <Cell label="Customer churn" value={`${customerChurnPct.toFixed(1)}%`} hint="Over the period" tone={customerChurnPct > 10 ? "warning" : "default"} />
      </div>

      <div className="border-t p-5">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">MRR</span>
          <span className="text-xs text-muted-foreground">
            {formatShortDate(chronological[0].date)} → {formatShortDate(chronological[chronological.length - 1].date)}
          </span>
        </div>
        <Sparkline snapshots={chronological} />
      </div>
    </section>
  );
}

function Cell({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "success" | "warning" | "muted";
}) {
  const tones = {
    default: "",
    success: "text-success",
    warning: "text-warning",
    muted: "text-muted-foreground",
  };
  return (
    <div className="bg-card p-5">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={cn("mt-1.5 text-2xl font-semibold tabular-nums", tones[tone])}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

/**
 * Minimal SVG line chart. Deliberately no library — the shape is a single polyline over N
 * points, and pulling in a chart lib for that would triple the bundle.
 *
 * viewBox is a fixed 400×80 coordinate space; the SVG itself is sized 100% by CSS so it
 * scales with the container.
 */
function Sparkline({ snapshots }: { snapshots: MetricsSnapshot[] }) {
  if (snapshots.length < 2) {
    return (
      <div className="rounded bg-muted/40 p-3 text-xs text-muted-foreground">
        One datapoint so far. A line needs at least two — the snapshotter runs nightly.
      </div>
    );
  }

  const W = 400;
  const H = 80;
  const values = snapshots.map((s) => s.mrrCents);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min); // guard against a flat series

  const points = snapshots.map((s, i) => {
    const x = (i / (snapshots.length - 1)) * W;
    const y = H - ((s.mrrCents - min) / range) * H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  const areaPoints = `0,${H} ${points} ${W},${H}`;

  return (
    <div className="space-y-1">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-20 w-full"
        aria-label="MRR over time"
      >
        <polygon
          points={areaPoints}
          className="fill-primary/10"
        />
        <polyline
          points={points}
          fill="none"
          strokeWidth={1.5}
          className="stroke-primary"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground">
        <span>{formatMoney(min)}</span>
        <span>{formatMoney(max)}</span>
      </div>
    </div>
  );
}

function formatShortDate(date: string): string {
  // date is "YYYY-MM-DD" — parse without triggering local timezone shenanigans.
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
