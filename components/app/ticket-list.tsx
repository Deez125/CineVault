import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TicketWithMeta } from "@/lib/tickets";
import { categoryLabel, priorityLabel, priorityTone } from "@/lib/ticket-types";

/** The inbox row, shared by the member's list and the admin's. */
export function TicketList({
  tickets,
  hrefBase,
  showEmail = false,
  empty,
}: {
  tickets: TicketWithMeta[];
  hrefBase: string;
  /** The admin needs to know whose ticket it is; the member already knows. */
  showEmail?: boolean;
  empty: string;
}) {
  if (tickets.length === 0) {
    return (
      <p className="rounded-xl border bg-card px-5 py-16 text-center text-sm text-muted-foreground">
        {empty}
      </p>
    );
  }

  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card">
      {tickets.map((ticket) => (
        <li key={ticket.id}>
          <Link
            href={`${hrefBase}/${ticket.id}`}
            className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-muted/40"
          >
            {/* A dot, not a bold row: it survives being scanned quickly and does not shout. */}
            <span
              className={cn(
                "mt-1.5 size-2 shrink-0 rounded-full",
                ticket.unread ? "bg-primary" : "bg-transparent"
              )}
              aria-label={ticket.unread ? "Unread" : undefined}
            />

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("truncate text-sm", ticket.unread && "font-semibold")}>
                  {ticket.subject}
                </span>
                {ticket.status === "closed" && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    closed
                  </span>
                )}
                {/* Only shown when it is not "normal". A badge on every row would be noise,
                    and the point of a priority is that it stands out from the rest. */}
                {ticket.priority !== "normal" && (
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ring-current/25",
                      priorityTone(ticket.priority)
                    )}
                  >
                    {priorityLabel(ticket.priority)}
                  </span>
                )}
              </div>

              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                {showEmail && (
                  <>
                    <span>{ticket.email}</span>
                    <span aria-hidden>·</span>
                  </>
                )}
                <span>{categoryLabel(ticket.category)}</span>
                <span aria-hidden>·</span>
                <span className="flex items-center gap-1">
                  <MessageSquare className="size-3" />
                  {ticket.messageCount}
                </span>
                <span aria-hidden>·</span>
                <span>{timeAgo(ticket.lastMessageAt)}</span>
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function timeAgo(date: Date): string {
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
