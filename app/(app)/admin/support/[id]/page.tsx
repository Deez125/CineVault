import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { TicketThread } from "@/components/app/ticket-thread";
import { requireAdmin } from "@/lib/auth";
import { displayName } from "@/lib/display-name";
import { getTicket, getTicketOwner, listMessages, markRead } from "@/lib/tickets";
import { formatStreamLimit } from "@/lib/plans";

export const metadata: Metadata = { title: "Ticket" };

export default async function AdminTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;

  const ticket = await getTicket(id, { id: admin.id, isAdmin: true });
  if (!ticket) notFound();

  const [messages, owner] = await Promise.all([
    listMessages(ticket.id),
    getTicketOwner(ticket),
  ]);

  await markRead(ticket.id, true);

  return (
    /* Pinned to the viewport only from `lg`, where the thread goes side-by-side. See the
       member-facing ticket page for why. */
    <div className="flex flex-col lg:h-[calc(100dvh-7rem)]">
      <Link
        href="/admin/support"
        className="mb-3 inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Inbox
      </Link>

      <PageHeader
        title={ticket.subject}
        subtitle={ticket.email}
      />

      {/* Who is asking, and what state their account is in. Answering a support question
          without this means opening the users page in another tab every single time. */}
      {owner && (
        <dl className="mb-4 flex flex-wrap gap-x-6 gap-y-2 rounded-xl border bg-card px-5 py-3 text-sm">
          <Fact label="Member" value={displayName(owner)} />
          <Fact
            label="Plan"
            value={owner.isMember ? formatStreamLimit(owner.streamLimit) : "none"}
          />
          <Fact label="Plex" value={owner.plexUsername ?? "not linked"} />
          {owner.banned && <Fact label="Status" value="banned" tone="destructive" />}
          <Link
            href={`/admin/users?q=${encodeURIComponent(owner.email)}`}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Open in users
          </Link>
        </dl>
      )}

      <TicketThread
        viewerRole="admin"
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

function Fact({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "destructive";
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={tone === "destructive" ? "text-destructive" : undefined}>{value}</dd>
    </div>
  );
}
