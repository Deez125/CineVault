import { lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions } from "@/lib/db/schema";

/**
 * Periodic housekeeping, run by the worker.
 *
 * Deliberately NOT in lib/auth/session.ts. That module is marked `server-only` because it
 * reads and writes cookies, which genuinely only makes sense inside a request — but the
 * marker throws when imported from plain Node, and the worker has no request context at all.
 * These functions touch the database and nothing else, so they live where both can reach
 * them.
 */

/** Delete sessions that have already expired. Dead weight, and a small privacy leak. */
export async function pruneExpiredSessions(): Promise<number> {
  const deleted = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, new Date()))
    .returning({ id: sessions.id });

  return deleted.length;
}
