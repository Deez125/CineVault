import { CircleAlert } from "lucide-react";
import type { LiveMetrics } from "@/lib/analytics/stripe-live";
import { NowSectionClient } from "./now-section-client";

/**
 * Server wrapper. All the fetching is done by the parent page; this just checks for the
 * upstream-failed case (null) before handing detail to the client component that owns the
 * click-through dialogs.
 *
 * Everything interactive — the eight clickable cards, the breakdown popup — lives in
 * NowSectionClient because a Dialog needs client-side state to open and close.
 */
export function NowSection({ live }: { live: LiveMetrics | null }) {
  if (!live) {
    return (
      <section className="rounded-xl border border-warning/40 bg-warning/5 p-5 text-sm">
        <div className="flex items-center gap-2 font-medium text-warning">
          <CircleAlert className="size-4" />
          Stripe unreachable
        </div>
        <p className="mt-1 text-muted-foreground">
          The right-now figures couldn&apos;t be fetched from Stripe. Historical panels below
          are unaffected — those read from the snapshot table.
        </p>
      </section>
    );
  }

  return <NowSectionClient live={live} />;
}
