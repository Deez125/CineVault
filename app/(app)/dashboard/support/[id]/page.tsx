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
    /* The fixed height only applies from `lg`, which is exactly where TicketThread turns
       side-by-side. Below that the details panel stacks UNDER the conversation, and pinning
       the page to the viewport made the two fight over it — on a phone the message list came
       out a couple of centimetres tall. Unpinned, the thread grows and the page scrolls,
       which is how a conversation on a phone is meant to behave. Jump-to-newest still works:
       scrollIntoView scrolls whichever ancestor scrolls, window included. */
    <div className="flex flex-col lg:h-[calc(100dvh-7rem)]">
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
        viewerRole="user"
        ticket={{
          id: ticket.id,
          subject: ticket.subject,
          status: ticket.status,
          priority: ticket.priority,
          category: ticket.category,
          createdAt: ticket.createdAt.toISOString(),
          closedAt: ticket.closedAt?.toISOString() ?? null,
        }}
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
