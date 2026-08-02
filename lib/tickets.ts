import { and, asc, count, desc, eq, gt, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ticketMessages, tickets, users, type Ticket, type TicketMessage } from "@/lib/db/schema";
import { displayName } from "@/lib/display-name";
import { logEvent } from "@/lib/events";

/**
 * Support tickets.
 *
 * Every read here takes a viewer and enforces what they may see. A "get ticket by id" that
 * trusts its caller is one forgotten check away from letting anybody read anyone's support
 * history by guessing a UUID, and support threads carry email addresses, billing complaints,
 * and occasionally passwords people should not have typed.
 */

export const TICKET_OPEN = "open";
export const TICKET_CLOSED = "closed";

export type Viewer = { id: string; isAdmin: boolean };

export type TicketWithMeta = Ticket & {
  messageCount: number;
  /** Unread BY THE VIEWER. Same ticket, different answer for each side. */
  unread: boolean;
};

/** Can this viewer see this ticket? Admins see everything; members see their own. */
function canSee(ticket: Ticket, viewer: Viewer): boolean {
  return viewer.isAdmin || ticket.userId === viewer.id;
}

export class TicketAccessError extends Error {
  constructor() {
    // Deliberately the same wording as "does not exist". Telling somebody a ticket exists but
    // is not theirs confirms the id is real, which is exactly what a person probing would
    // want to learn.
    super("No such ticket.");
    this.name = "TicketAccessError";
  }
}

/** One ticket, or null if the viewer may not see it (including because it is not there). */
export async function getTicket(id: string, viewer: Viewer): Promise<Ticket | null> {
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  if (!ticket || !canSee(ticket, viewer)) return null;
  return ticket;
}

/** A member's own tickets, newest activity first. */
export async function listMyTickets(userId: string): Promise<TicketWithMeta[]> {
  const rows = await db
    .select({
      ticket: tickets,
      // The outer column is qualified explicitly: Drizzle emits an unqualified name inside
      // a subquery, so "id" would bind to ticket_messages.id (bigint) rather than
      // tickets.id (uuid), and Postgres refuses with "no operator matches" 42883.
      messageCount: sql<number>`(
        select count(*) from ${ticketMessages}
        where ${ticketMessages.ticketId} = ${sql.raw(`"tickets"."id"`)}
      )`.mapWith(Number),
    })
    .from(tickets)
    .where(eq(tickets.userId, userId))
    .orderBy(desc(tickets.lastMessageAt))
    .limit(100);

  return rows.map(({ ticket, messageCount }) => ({
    ...ticket,
    messageCount,
    unread: isUnreadFor(ticket, false),
  }));
}

export type InboxFilter = "open" | "closed" | "all";

/** Every ticket, for the admin inbox. */
export async function listAllTickets(filter: InboxFilter = "open"): Promise<TicketWithMeta[]> {
  const rows = await db
    .select({
      ticket: tickets,
      messageCount: sql<number>`(
        select count(*) from ${ticketMessages}
        where ${ticketMessages.ticketId} = ${sql.raw(`"tickets"."id"`)}
      )`.mapWith(Number),
    })
    .from(tickets)
    .where(filter === "all" ? undefined : eq(tickets.status, filter))
    .orderBy(desc(tickets.lastMessageAt))
    .limit(200);

  return rows.map(({ ticket, messageCount }) => ({
    ...ticket,
    messageCount,
    unread: isUnreadFor(ticket, true),
  }));
}

/**
 * Has this side seen the latest message?
 *
 * Compared against `lastMessageAt`, which means a ticket is unread when the OTHER side has
 * said something since you last looked. Your own reply does not mark your own ticket unread,
 * because opening it to send that reply set your read marker past it.
 */
function isUnreadFor(ticket: Ticket, asAdmin: boolean): boolean {
  const readAt = asAdmin ? ticket.adminReadAt : ticket.userReadAt;
  if (!readAt) return true;
  return ticket.lastMessageAt.getTime() > readAt.getTime();
}

/** How many tickets are waiting on the admin. Drives the sidebar badge. */
export async function countAwaitingAdmin(): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(tickets)
    .where(
      and(
        eq(tickets.status, TICKET_OPEN),
        sql`(${tickets.adminReadAt} is null or ${tickets.lastMessageAt} > ${tickets.adminReadAt})`
      )
    );

  return row?.n ?? 0;
}

/**
 * Messages, optionally only those after `since`.
 *
 * `since` is what makes the live view cheap: once the conversation is loaded, every poll asks
 * for the handful of messages the client has not got, and almost always receives none.
 */
export async function listMessages(
  ticketId: string,
  since?: number
): Promise<TicketMessage[]> {
  return db
    .select()
    .from(ticketMessages)
    .where(
      since
        ? and(eq(ticketMessages.ticketId, ticketId), gt(ticketMessages.id, since))
        : eq(ticketMessages.ticketId, ticketId)
    )
    .orderBy(asc(ticketMessages.id))
    .limit(500);
}

export type NewTicket = { subject: string; body: string };

export async function createTicket(
  input: NewTicket,
  author: { id: string; email: string; username: string | null; firstName: string | null; lastName: string | null }
): Promise<Ticket> {
  const now = new Date();

  const [ticket] = await db
    .insert(tickets)
    .values({
      userId: author.id,
      email: author.email,
      subject: input.subject,
      status: TICKET_OPEN,
      lastMessageAt: now,
      // They have obviously read the message they just wrote.
      userReadAt: now,
    })
    .returning();

  await db.insert(ticketMessages).values({
    ticketId: ticket.id,
    authorId: author.id,
    authorRole: "user",
    authorName: displayName(author),
    body: input.body,
    createdAt: now,
  });

  await logEvent({
    type: "admin_action",
    actor: "user",
    userId: author.id,
    email: author.email,
    message: `${author.email} opened a ticket: ${input.subject}`,
    detail: { ticketId: ticket.id },
  });

  return ticket;
}

/**
 * Add a message.
 *
 * Reopens a closed ticket rather than refusing. Somebody replying to a closed thread has more
 * to say about the same problem, and making them start again — losing the context an admin
 * would need — helps nobody.
 */
export async function addMessage(
  ticketId: string,
  body: string,
  author: { id: string; isAdmin: boolean; email: string; username: string | null; firstName: string | null; lastName: string | null }
): Promise<TicketMessage> {
  const now = new Date();
  const role = author.isAdmin ? "admin" : "user";

  const [message] = await db
    .insert(ticketMessages)
    .values({
      ticketId,
      authorId: author.id,
      authorRole: role,
      authorName: author.isAdmin ? "CineVault" : displayName(author),
      body,
      createdAt: now,
    })
    .returning();

  await db
    .update(tickets)
    .set({
      lastMessageAt: now,
      status: TICKET_OPEN,
      closedAt: null,
      closedBy: null,
      // Only the sender's marker moves. The other side has not seen this yet, which is the
      // whole point of tracking it.
      ...(author.isAdmin ? { adminReadAt: now } : { userReadAt: now }),
    })
    .where(eq(tickets.id, ticketId));

  return message;
}

/** Mark as read for one side. Called when the conversation is opened. */
export async function markRead(ticketId: string, asAdmin: boolean): Promise<void> {
  await db
    .update(tickets)
    .set(asAdmin ? { adminReadAt: new Date() } : { userReadAt: new Date() })
    .where(eq(tickets.id, ticketId));
}

export async function setStatus(
  ticketId: string,
  status: typeof TICKET_OPEN | typeof TICKET_CLOSED,
  by: { id: string; email: string; isAdmin: boolean }
): Promise<void> {
  const closing = status === TICKET_CLOSED;
  const now = new Date();

  await db
    .update(tickets)
    .set({
      status,
      closedAt: closing ? now : null,
      closedBy: closing ? by.id : null,
      lastMessageAt: now,
    })
    .where(eq(tickets.id, ticketId));

  // A note in the thread, so reopening later shows WHY it stopped rather than an unexplained
  // gap between two messages.
  await db.insert(ticketMessages).values({
    ticketId,
    authorId: by.id,
    authorRole: "system",
    authorName: by.isAdmin ? "CineVault" : by.email,
    body: closing ? "Ticket closed." : "Ticket reopened.",
    createdAt: now,
  });
}

/** Everything the live view needs in one call. */
export async function getConversation(ticketId: string, viewer: Viewer, since?: number) {
  const ticket = await getTicket(ticketId, viewer);
  if (!ticket) throw new TicketAccessError();

  const messages = await listMessages(ticketId, since);
  return { ticket, messages };
}

/** Open tickets a member already has. Used to stop them opening five for one problem. */
export async function countOpenFor(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(tickets)
    .where(and(eq(tickets.userId, userId), ne(tickets.status, TICKET_CLOSED)));

  return row?.n ?? 0;
}

/** The member behind a ticket, for the admin view. */
export async function getTicketOwner(ticket: Ticket) {
  if (!ticket.userId) return null;

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      username: users.username,
      firstName: users.firstName,
      lastName: users.lastName,
      isMember: users.isMember,
      streamLimit: users.streamLimit,
      plexUsername: users.plexUsername,
      banned: users.banned,
    })
    .from(users)
    .where(eq(users.id, ticket.userId))
    .limit(1);

  return user ?? null;
}
