import Link from "next/link";
import { Download, Info, UserRoundX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { DormantBucket, DormantRow } from "@/lib/analytics/dormant";

/**
 * Dormant subscribers: paying but not watching.
 *
 * The one panel Stripe cannot produce — a join between billing and playback. The list
 * itself comes from a cached user_activity refreshed by the worker, so this render is a
 * plain SELECT with no upstream calls.
 *
 * "Unlinked" (subscribed, no Plex account linked) is a provisioning bug worth surfacing
 * on its own — those aren't dormant, they never had access to begin with. "Onboarding"
 * (subscribed within 7 days, never watched) is excluded from dormancy for the same reason
 * we don't count new signups against churn: too fresh to judge.
 */

const BUCKET_LABELS: Record<DormantBucket, string> = {
  onboarding: "Onboarding",
  unlinked: "Unlinked",
  recent: "Watched this week",
  week: "8–30 days",
  month: "31–60 days",
  twoMonths: "31–60 days", // reserved for a future finer split
  long: "60+ days",
  never: "Never watched",
};

const CONCERN_BUCKETS: DormantBucket[] = ["month", "long", "never", "unlinked"];

export function DormantSection({ rows }: { rows: DormantRow[] }) {
  const concerning = rows.filter((r) => CONCERN_BUCKETS.includes(r.bucket));
  const totalMonthlyAtRisk = concerning.reduce((sum, r) => sum + (r.monthlyCents ?? 0), 0);

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3.5">
        <div>
          <h2 className="text-sm font-semibold">Dormant subscribers</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Subscribed but not watching. {concerning.length} at risk —{" "}
            {formatMoney(totalMonthlyAtRisk)}/mo.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          render={<Link href="/admin/analytics/dormant.csv" prefetch={false} />}
        >
          <Download className="size-3.5" />
          Export CSV
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">
          Nobody on the books yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-2.5 font-medium">Who</th>
                <th className="px-5 py-2.5 font-medium">Tier</th>
                <th className="px-5 py-2.5 text-right font-medium">MRR</th>
                <th className="px-5 py-2.5 font-medium">Last watched</th>
                <th className="px-5 py-2.5 font-medium">Bucket</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.userId} className={cn(r.bucket === "onboarding" && "opacity-60")}>
                  <td className="px-5 py-3">
                    <div className="font-medium">{r.displayName}</div>
                    <div className="text-xs text-muted-foreground">{r.email}</div>
                  </td>
                  <td className="px-5 py-3">{tierLabel(r.streamLimit)}</td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {r.monthlyCents !== null ? formatMoney(r.monthlyCents) : "—"}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {r.lastWatchedAt ? relativeDays(r.daysSinceWatched) : "never"}
                  </td>
                  <td className="px-5 py-3">
                    <BucketPill bucket={r.bucket} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center gap-2 border-t px-5 py-2.5 text-xs text-muted-foreground">
        <Info className="size-3.5" />
        <UserRoundX className="hidden size-3.5" />
        <span>
          Refreshed by the nightly worker. Members added in the last 7 days are excluded as
          &quot;onboarding&quot; and don&apos;t count toward &quot;at risk&quot;.
        </span>
      </div>
    </section>
  );
}

function tierLabel(streamLimit: number): string {
  if (streamLimit < 0) return "Admin";
  if (streamLimit === 0) return "—";
  return `${streamLimit} stream${streamLimit === 1 ? "" : "s"}`;
}

function relativeDays(days: number | null): string {
  if (days === null) return "—";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} mo ago`;
  const years = Math.round(days / 365);
  return `${years}y ago`;
}

function BucketPill({ bucket }: { bucket: DormantBucket }) {
  const tone = bucketTone(bucket);
  const tones = {
    default: "bg-muted text-muted-foreground ring-border",
    success: "bg-success/10 text-success ring-success/25",
    warning: "bg-warning/10 text-warning ring-warning/25",
    destructive: "bg-destructive/10 text-destructive ring-destructive/25",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        tones[tone]
      )}
    >
      {BUCKET_LABELS[bucket]}
    </span>
  );
}

function bucketTone(bucket: DormantBucket): "default" | "success" | "warning" | "destructive" {
  switch (bucket) {
    case "recent":
      return "success";
    case "week":
    case "onboarding":
      return "default";
    case "month":
    case "unlinked":
      return "warning";
    case "long":
    case "never":
      return "destructive";
    default:
      return "default";
  }
}
