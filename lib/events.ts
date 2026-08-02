import { desc, eq, and, gte, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { events, type NewEvent } from "@/lib/db/schema";

/**
 * The audit log.
 *
 * Every consequential action lands here, in order. This is what the admin activity feed
 * reads, and more importantly it is the only record of why somebody lost access at 3am. When
 * a customer says "I was watching and it stopped", this table is the answer.
 *
 * Two rules:
 *
 *   1. Writing an event must NEVER break the thing it is recording. If the log write fails,
 *      we log to stderr and carry on. An audit trail that can roll back a Plex revocation is
 *      worse than no audit trail.
 *
 *   2. Money is stored in MINOR UNITS with its currency, and formatted only at display.
 *      "$20" in a log row is ambiguous the moment anyone pays in anything else.
 */

export const EVENT_TYPES = [
  "account_created",
  "membership_gained",
  "membership_lost",
  "tier_changed",
  "cancel_scheduled",
  "cancel_reversed",
  "payment_failed",
  "plex_linked",
  "plex_unlinked",
  "access_granted",
  "access_revoked",
  "stream_killed",
  "user_banned",
  "user_unbanned",
  "admin_action",
  "error",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];
export type Severity = "info" | "warn" | "error";

/**
 * Who caused this.
 *
 * Worth being precise about: "membership_lost, actor: reconciler" and "membership_lost,
 * actor: admin:4f2a" are the same event with completely different explanations, and you only
 * ever want to know which at the moment something has gone wrong.
 */
export type Actor =
  | "system"
  | "webhook"
  | "reconciler"
  | "enforcer"
  | "user"
  | `admin:${string}`;

export type LogEventInput = {
  type: EventType;
  message: string;
  severity?: Severity;
  actor?: Actor;
  userId?: string | null;
  /** Denormalised so the log stays readable after the account is deleted. */
  email?: string | null;
  plexUsername?: string | null;
  detail?: Record<string, unknown> | null;
};

export async function logEvent(input: LogEventInput): Promise<void> {
  const row: NewEvent = {
    type: input.type,
    severity: input.severity ?? "info",
    actor: input.actor ?? "system",
    userId: input.userId ?? null,
    email: input.email ?? null,
    plexUsername: input.plexUsername ?? null,
    message: input.message,
    detail: input.detail ?? null,
  };

  try {
    await db.insert(events).values(row);
  } catch (err) {
    // Deliberately swallowed. See rule 1 above.
    console.error("[events] failed to write audit event:", err, row);
  }
}

/** Convenience for the many places that want to record a failure without throwing. */
export async function logError(
  message: string,
  detail?: Record<string, unknown>,
  context: Partial<LogEventInput> = {}
): Promise<void> {
  console.error(`[error] ${message}`, detail ?? "");
  await logEvent({ ...context, type: "error", severity: "error", message, detail });
}

export type EventQuery = {
  limit?: number;
  type?: EventType;
  userId?: string;
  since?: Date;
};

/** The activity feed. Newest first. */
export async function listEvents(query: EventQuery = {}) {
  const filters: SQL[] = [];
  if (query.type) filters.push(eq(events.type, query.type));
  if (query.userId) filters.push(eq(events.userId, query.userId));
  if (query.since) filters.push(gte(events.ts, query.since));

  return db
    .select()
    .from(events)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(events.ts))
    .limit(Math.min(query.limit ?? 50, 500));
}
