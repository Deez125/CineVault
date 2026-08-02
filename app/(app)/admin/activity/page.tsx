import Link from "next/link";
import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { EventFeed } from "@/components/app/event-feed";
import { EVENT_TYPES, listEvents, type EventType } from "@/lib/events";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Activity log" };

/** The handful worth filtering by directly. The rest are reachable through "All". */
const QUICK: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "membership_gained", label: "Subscribed" },
  { value: "membership_lost", label: "Lost access" },
  { value: "plex_linked", label: "Plex linked" },
  { value: "access_granted", label: "Granted" },
  { value: "access_revoked", label: "Revoked" },
  { value: "admin_action", label: "Admin" },
  { value: "error", label: "Errors" },
];

export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const params = await searchParams;

  const type = (EVENT_TYPES as readonly string[]).includes(params.type ?? "")
    ? (params.type as EventType)
    : undefined;

  const events = await listEvents({ type, limit: 200 });

  return (
    <>
      <PageHeader
        title="Activity log"
        subtitle="Every consequential action, newest first"
        badge={events.length}
      />

      <nav className="mb-4 flex flex-wrap gap-1.5">
        {QUICK.map((option) => {
          const active = (option.value || undefined) === type;

          return (
            <Link
              key={option.value || "all"}
              href={option.value ? `/admin/activity?type=${option.value}` : "/admin/activity"}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                active
                  ? "border-primary bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {option.label}
            </Link>
          );
        })}
      </nav>

      <div className="rounded-xl border bg-card">
        <EventFeed
          events={events}
          empty={
            type
              ? "Nothing of that kind has happened yet."
              : "Nothing has happened yet. Events appear here as people subscribe, link Plex, and gain or lose access."
          }
        />
      </div>

      {events.length >= 200 && (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Showing the most recent 200.
        </p>
      )}
    </>
  );
}
