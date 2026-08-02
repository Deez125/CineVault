import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * Is this container actually working?
 *
 * Used by the container healthcheck and by Coolify to decide whether a new deploy is good
 * enough to take traffic. It deliberately touches the DATABASE rather than just returning
 * 200: a Next.js process can be listening and answering while its connection pool is dead,
 * and that state serves errors to every visitor while looking perfectly healthy to anything
 * that only checks the port.
 *
 * Says nothing about versions, configuration, or why a failure happened. This endpoint is
 * unauthenticated and reachable by anyone, so it answers exactly one question.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    // 503, not 500. "I am temporarily unable to serve" is what a load balancer needs to hear
    // to route around this container rather than retire it.
    return Response.json({ ok: false }, { status: 503 });
  }
}
