import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { TicketList } from "@/components/app/ticket-list";
import { NewTicketButton } from "./new-ticket";
import { requireUser } from "@/lib/auth";
import { listMyTickets } from "@/lib/tickets";

export const metadata: Metadata = { title: "Support" };

export default async function SupportPage() {
  const user = await requireUser("/dashboard/support");
  const tickets = await listMyTickets(user.id);

  return (
    <>
      <PageHeader
        title="Support"
        subtitle="Ask us anything"
        badge={tickets.filter((t) => t.status === "open").length || undefined}
        action={<NewTicketButton />}
      />

      <TicketList
        tickets={tickets}
        hrefBase="/dashboard/support"
        empty="No tickets yet. Open one and we'll reply here."
      />
    </>
  );
}
