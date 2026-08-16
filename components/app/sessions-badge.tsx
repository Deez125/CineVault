"use client";

import Link from "next/link";
import { ArrowRight, MonitorPlay } from "lucide-react";
import { useMySessions } from "@/hooks/use-my-sessions";
import { isUnlimited } from "@/lib/plans";

/**
 * The compact "watching now" strip on /dashboard.
 *
 * Between recently-added and the server card. Not a full session listing — the point on this
 * page is a single glance: how many streams are up, out of the allowance, with a link into
 * the full panel on /dashboard/plex. Anything richer than that belongs on the page it links
 * to.
 *
 * Silent for non-members: the strip only makes sense for someone who has an allowance.
 */

export function SessionsBadge({
  isMember,
  streamLimit,
}: {
  isMember: boolean;
  streamLimit: number;
}) {
  const { sessions, allowance, initialLoading } = useMySessions({ enabled: isMember });

  if (!isMember) return null;

  const limit = allowance?.limit ?? streamLimit;
  const used = allowance?.used ?? sessions.length;
  const unlimited = isUnlimited(limit);
  const active = used > 0;

  return (
    <Link
      href="/dashboard/plex"
      className="group flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card px-5 py-4 transition-colors hover:bg-muted/40"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <MonitorPlay className="size-4" />
      </span>

      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="text-sm font-semibold">
          {initialLoading ? "Checking sessions…" : label(used, active)}
        </span>
        <span className="text-xs text-muted-foreground">
          {unlimited ? (
            "Unlimited streams"
          ) : (
            <>
              {used} of {limit} stream{limit === 1 ? "" : "s"} in use
            </>
          )}
        </span>
      </div>

      {/* A pinch of live-ness so a full stream count is visible from across the room without
          having to read anything. */}
      {active && !unlimited && used === limit && (
        <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-warning ring-1 ring-inset ring-warning/25">
          At limit
        </span>
      )}

      <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground transition-colors group-hover:text-foreground">
        {sessions.length > 0 ? "View" : "Manage"}
        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

function label(used: number, active: boolean): string {
  if (!active) return "Nothing playing";
  if (used === 1) return "1 stream playing";
  return `${used} streams playing`;
}
