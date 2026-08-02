import {
  Ban,
  CircleCheck,
  CircleMinus,
  CirclePlus,
  CreditCard,
  Link2,
  ShieldAlert,
  TriangleAlert,
  Unlink,
  UserPlus,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Event } from "@/lib/db/schema";

/**
 * The audit feed.
 *
 * Each row says what happened, to whom, and — the part that matters at 3am — WHO OR WHAT did
 * it. "membership_lost by the reconciler" and "membership_lost by admin:4f2a" are the same
 * event with completely different explanations.
 */

const ICONS: Record<string, LucideIcon> = {
  account_created: UserPlus,
  membership_gained: CirclePlus,
  membership_lost: CircleMinus,
  tier_changed: CreditCard,
  cancel_scheduled: CircleMinus,
  cancel_reversed: CirclePlus,
  payment_failed: CreditCard,
  plex_linked: Link2,
  plex_unlinked: Unlink,
  access_granted: CircleCheck,
  access_revoked: CircleMinus,
  stream_killed: ShieldAlert,
  user_banned: Ban,
  user_unbanned: CircleCheck,
  admin_action: Wrench,
  error: TriangleAlert,
};

const TONES: Record<string, string> = {
  info: "text-muted-foreground",
  warn: "text-warning",
  error: "text-destructive",
};

export function EventFeed({ events, empty }: { events: Event[]; empty?: string }) {
  if (events.length === 0) {
    return (
      <p className="px-5 py-10 text-center text-sm text-muted-foreground">
        {empty ?? "Nothing here yet."}
      </p>
    );
  }

  return (
    <ul className="divide-y">
      {events.map((event) => {
        const Icon = ICONS[event.type] ?? Wrench;

        return (
          <li key={event.id} className="flex items-start gap-3 px-5 py-3">
            <Icon className={cn("mt-0.5 size-4 shrink-0", TONES[event.severity] ?? TONES.info)} />

            <div className="min-w-0 flex-1">
              <p className="text-sm">{event.message}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                <span className="font-mono">{event.type}</span>
                <span aria-hidden>·</span>
                <span>{formatActor(event.actor)}</span>
                {event.plexUsername && (
                  <>
                    <span aria-hidden>·</span>
                    <span>{event.plexUsername}</span>
                  </>
                )}
              </p>
            </div>

            <time
              className="shrink-0 text-xs tabular-nums text-muted-foreground"
              dateTime={event.ts.toISOString()}
              title={event.ts.toLocaleString()}
            >
              {timeAgo(event.ts)}
            </time>
          </li>
        );
      })}
    </ul>
  );
}

/** `admin:<uuid>` is unreadable in a feed; the uuid is in the row's detail if it is needed. */
function formatActor(actor: string): string {
  if (actor.startsWith("admin:")) return "admin";
  return actor;
}

function timeAgo(date: Date): string {
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
