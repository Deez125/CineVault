import { z } from "zod";
import { apiUser } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { logError } from "@/lib/events";
import { rateLimit } from "@/lib/rate-limit";
import { countOpenFor, createTicket } from "@/lib/tickets";

const schema = z.object({
  subject: z.string().trim().min(3, "Give it a short subject.").max(120),
  body: z.string().trim().min(5, "Tell us what's happening.").max(5000),
});

export async function POST(request: Request) {
  const auth = await apiUser();
  if (!auth.ok) return auth.response;

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Check the form." },
      { status: 400 }
    );
  }

  const limit = rateLimit(`ticket:${auth.user.id}`, 5, 60 * 60 * 1000);
  if (!limit.allowed) {
    return Response.json(
      { error: "You've opened a few tickets recently. Reply to an existing one instead." },
      { status: 429 }
    );
  }

  // Five open at once is already more problems than one person has. Beyond that it is
  // usually the same problem restated, which splits the conversation and makes it harder to
  // answer, not easier.
  if ((await countOpenFor(auth.user.id)) >= 5) {
    return Response.json(
      { error: "You already have several open tickets. Reply to one of those instead." },
      { status: 409 }
    );
  }

  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "not signed in" }, { status: 401 });

  try {
    const ticket = await createTicket(parsed.data, user);
    return Response.json({ ok: true, id: ticket.id });
  } catch (err) {
    await logError(
      "could not open ticket",
      { error: err instanceof Error ? err.message : String(err) },
      { userId: user.id, email: user.email, actor: "user" }
    );
    return Response.json({ error: "Couldn't open that ticket. Try again." }, { status: 502 });
  }
}
