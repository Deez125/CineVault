import { z } from "zod";
import { apiUser } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { logError } from "@/lib/events";
import { rateLimit } from "@/lib/rate-limit";
import { TicketAccessError, addMessage, getConversation, markRead } from "@/lib/tickets";

/**
 * The live endpoint.
 *
 * GET with `?since=<id>` returns only what the caller has not got. That is what makes polling
 * cheap enough to do every few seconds: an idle conversation answers with an empty array and
 * one small query.
 *
 * WHY POLLING AND NOT SSE OR WEBSOCKETS. Both would be genuinely instant, and both need a way
 * for one process to tell another that a message arrived — an in-memory emitter works
 * perfectly on one container and silently stops working on two, which is the worst kind of
 * bug to ship because everything looks fine until the day it does not. Postgres LISTEN/NOTIFY
 * would fix that properly and is the upgrade path when it is worth it. At this size, a
 * three-second poll is indistinguishable from instant and cannot break that way.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiUser();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "No such ticket." }, { status: 404 });
  }

  const sinceRaw = new URL(request.url).searchParams.get("since");
  const since = sinceRaw ? Number(sinceRaw) : undefined;

  try {
    const { ticket, messages } = await getConversation(
      id,
      { id: auth.user.id, isAdmin: auth.user.isAdmin },
      Number.isFinite(since) && since! > 0 ? since : undefined
    );

    // Seeing it counts as reading it, but only when something actually arrived — otherwise
    // every poll writes a row for no reason.
    if (messages.length > 0) {
      await markRead(id, auth.user.isAdmin);
    }

    return Response.json({
      status: ticket.status,
      lastMessageAt: ticket.lastMessageAt,
      messages,
    });
  } catch (err) {
    if (err instanceof TicketAccessError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
}

const bodySchema = z.object({
  body: z.string().trim().min(1, "Write something first.").max(5000),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiUser();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "No such ticket." }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Write something first." },
      { status: 400 }
    );
  }

  const limit = rateLimit(`ticket-msg:${auth.user.id}`, 30, 5 * 60 * 1000);
  if (!limit.allowed) {
    return Response.json({ error: "Slow down a moment." }, { status: 429 });
  }

  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "not signed in" }, { status: 401 });

  try {
    // Fetched through the same access check as everything else, so replying to somebody
    // else's ticket is refused for the same reason reading it is.
    const { ticket } = await getConversation(id, { id: user.id, isAdmin: user.isAdmin });

    const message = await addMessage(ticket.id, parsed.data.body, {
      id: user.id,
      isAdmin: user.isAdmin,
      email: user.email,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
    });

    return Response.json({ ok: true, message });
  } catch (err) {
    if (err instanceof TicketAccessError) {
      return Response.json({ error: err.message }, { status: 404 });
    }

    await logError(
      "could not post ticket message",
      { error: err instanceof Error ? err.message : String(err), ticketId: id },
      { userId: user.id, email: user.email, actor: user.isAdmin ? `admin:${user.id}` : "user" }
    );
    return Response.json({ error: "Couldn't send that. Try again." }, { status: 502 });
  }
}
