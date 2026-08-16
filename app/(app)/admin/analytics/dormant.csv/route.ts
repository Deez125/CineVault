import { apiAdmin } from "@/lib/auth";
import { listDormantSubscribers } from "@/lib/analytics/dormant";

/**
 * Dormant subscribers, as CSV.
 *
 * Exists so the re-engagement email can be sent from outside the app without building a
 * campaign tool inside it. The URL sits under the analytics page — same admin gate as
 * everything else in this area, checked here in its own right (a page-level guard doesn't
 * cover a route handler).
 *
 * Route path `dormant.csv` renders as a file the browser downloads on click, thanks to
 * `content-disposition: attachment`. The name has a date suffix so a folder of exports
 * stays orderable.
 */
export async function GET() {
  const auth = await apiAdmin();
  if (!auth.ok) return auth.response;

  const rows = await listDormantSubscribers();

  const header = [
    "email",
    "display_name",
    "tier_streams",
    "monthly_cents",
    "subscription_age_days",
    "last_watched_at",
    "days_since_watched",
    "bucket",
  ];

  const body = rows.map((r) =>
    [
      csvField(r.email),
      csvField(r.displayName ?? ""),
      String(r.streamLimit),
      r.monthlyCents !== null ? String(r.monthlyCents) : "",
      String(r.subscriptionAgeDays),
      r.lastWatchedAt ? r.lastWatchedAt.toISOString() : "",
      r.daysSinceWatched !== null ? String(r.daysSinceWatched) : "",
      r.bucket,
    ].join(",")
  );

  const csv = [header.join(","), ...body].join("\n") + "\n";
  const filename = `cinevault-dormant-${today()}.csv`;

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

/** Quote a field only when necessary — RFC 4180: comma, quote, or newline present. */
function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
