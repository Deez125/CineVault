import Link from "next/link";
import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { TicketList } from "@/components/app/ticket-list";
import { listAllTickets, type InboxFilter } from "@/lib/tickets";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Support inbox" };

const FILTERS: { value: InboxFilter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

export default async function AdminSupportPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const params = await searchParams;
  const filter = (FILTERS.find((f) => f.value === params.filter)?.value ?? "open") as InboxFilter;

  const tickets = await listAllTickets(filter);
  const waiting = tickets.filter((t) => t.unread).length;

  return (
    <>
      <PageHeader
        title="Support inbox"
        subtitle={waiting > 0 ? `${waiting} waiting on a reply` : "Nothing waiting"}
        badge={tickets.length}
      />

      <nav className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((option) => {
          const active = option.value === filter;
          return (
            <Link
              key={option.value}
              href={option.value === "open" ? "/admin/support" : `/admin/support?filter=${option.value}`}
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

      <TicketList
        tickets={tickets}
        hrefBase="/admin/support"
        showEmail
        empty={filter === "open" ? "No open tickets." : "Nothing here."}
      />
    </>
  );
}
