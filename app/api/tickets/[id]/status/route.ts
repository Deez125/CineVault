import { z } from "zod";
import { apiUser } from "@/lib/auth";
import { TICKET_CLOSED, TICKET_OPEN, TicketAccessError, getConversation, setStatus } from "@/lib/tickets";

/**
 * Close or reopen.
 *
 * Both sides may do both. A member who has sorted it out should be able to say so, and an
 * admin should be able to tidy up — and either can reopen, because "closed" here means
 * "nothing outstanding", not "you may not speak again".
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiUser();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "No such ticket." }, { status: 404 });
  }

  const parsed = z
    .object({ status: z.enum([TICKET_OPEN, TICKET_CLOSED]) })
    .safeParse(await request.json().catch(() => ({})));

  if (!parsed.success) {
    return Response.json({ error: "unknown status" }, { status: 400 });
  }

  try {
    const { ticket } = await getConversation(id, {
      id: auth.user.id,
      isAdmin: auth.user.isAdmin,
    });

    if (ticket.status === parsed.data.status) {
      return Response.json({ ok: true, unchanged: true });
    }

    await setStatus(ticket.id, parsed.data.status, {
      id: auth.user.id,
      email: auth.user.email,
      isAdmin: auth.user.isAdmin,
    });

    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof TicketAccessError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
}
