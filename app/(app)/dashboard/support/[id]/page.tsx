import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { TicketThread } from "@/components/app/ticket-thread";
import { requireUser } from "@/lib/auth";
import { getTicket, listMessages, markRead } from "@/lib/tickets";

export const metadata: Metadata = { title: "Ticket" };

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  // getTicket enforces ownership, so this 404s for somebody else's ticket exactly as it does
  // for one that never existed.
  const ticket = await getTicket(id, { id: user.id, isAdmin: user.isAdmin });
  if (!ticket) notFound();

  const messages = await listMessages(ticket.id);
  await markRead(ticket.id, false);

  return (
    <div className="flex h-[calc(100dvh-7rem)] flex-col">
      <Link
        href="/dashboard/support"
        className="mb-3 inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        All tickets
      </Link>

      <PageHeader
        title={ticket.subject}
        subtitle={
          ticket.status === "open"
            ? "Open. Replies appear here as they arrive."
            : "Closed. Replying reopens it."
        }
      />

      <TicketThread
        ticketId={ticket.id}
        initialStatus={ticket.status}
        viewerRole="user"
        initialMessages={messages.map((m) => ({
          id: m.id,
          authorRole: m.authorRole,
          authorName: m.authorName,
          body: m.body,
          createdAt: m.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
