import { Clock, Repeat } from "lucide-react";

/**
 * A visible slot for the top-transcoders panel we've deliberately left off the first cut.
 *
 * Rendered as a "coming soon" card rather than commented out or removed entirely because
 * the admin asked to leave room for it — the placeholder is the room. When the real panel
 * lands, replace this component with it and the surrounding page layout doesn't shift.
 *
 * The data layer is already in place: user_activity.transcode_count_30d is written by the
 * same nightly pass that populates lastWatchedAt (see lib/analytics/dormant.ts and
 * plex-history.ts). Turning this on is a matter of adding the real panel over that column.
 */
export function TopTranscodersPlaceholder() {
  return (
    <section className="rounded-xl border border-dashed bg-card/50 p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Repeat className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Top transcoders</h2>
        </div>
        <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          <Clock className="size-3" />
          Coming soon
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Who&apos;s pushing the server to transcode most often. Useful before spending money
        on a bigger box — a few heavy users nudged toward direct play often solves it.
      </p>
    </section>
  );
}
