import { and, desc, eq, gte, isNull, lte, notExists, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { announcementDismissals, announcements, type Announcement } from "@/lib/db/schema";
import { logEvent } from "@/lib/events";

/**
 * Announcements: the banner an admin can put on everybody's dashboard.
 *
 * For the things people would otherwise open a ticket about — the server is down, a library
 * is being re-encoded, maintenance on Sunday. The whole value is that it reaches people
 * BEFORE they ask, so it has to be quick to post and quick to take down.
 */

// Re-exported so server code has one import for announcements. The definitions live in a
// browser-safe module because client components need them too, and importing them from here
// would drag the Postgres driver into the browser bundle.
import type { Severity } from "./announcement-types";
export { SEVERITIES, isSeverity, type Severity } from "./announcement-types";

/**
 * What this user should see right now.
 *
 * Three things have to be true: it is switched on, it is inside its window, and they have not
 * already dismissed it. The dismissal check is a NOT EXISTS rather than a join so an
 * announcement is never duplicated by a stray dismissal row, and it is done in SQL rather
 * than in JS so a dismissed banner never flashes on screen before being filtered out.
 */
export async function listActiveFor(userId: string): Promise<Announcement[]> {
  const now = new Date();

  return db
    .select()
    .from(announcements)
    .where(
      and(
        eq(announcements.active, true),
        or(isNull(announcements.startsAt), lte(announcements.startsAt, now)),
        or(isNull(announcements.endsAt), gte(announcements.endsAt, now)),
        notExists(
          db
            .select({ one: sql`1` })
            .from(announcementDismissals)
            .where(
              and(
                eq(announcementDismissals.announcementId, announcements.id),
                eq(announcementDismissals.userId, userId)
              )
            )
        )
      )
    )
    .orderBy(desc(announcements.createdAt))
    .limit(5);
}

/** Everything, for the admin list. Includes off and expired ones. */
export async function listAll(): Promise<(Announcement & { dismissals: number })[]> {
  const rows = await db
    .select({
      announcement: announcements,
      dismissals: sql<number>`(
        select count(*) from ${announcementDismissals}
        where ${announcementDismissals.announcementId} = ${announcements.id}
      )`.mapWith(Number),
    })
    .from(announcements)
    .orderBy(desc(announcements.createdAt))
    .limit(100);

  return rows.map((row) => ({ ...row.announcement, dismissals: row.dismissals }));
}

export async function getAnnouncement(id: string): Promise<Announcement | null> {
  const [row] = await db.select().from(announcements).where(eq(announcements.id, id)).limit(1);
  return row ?? null;
}

export type AnnouncementInput = {
  title: string;
  body: string | null;
  severity: Severity;
  active: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
};

export async function createAnnouncement(
  input: AnnouncementInput,
  ctx: { adminId: string; adminEmail: string }
): Promise<Announcement> {
  const [created] = await db
    .insert(announcements)
    .values({ ...input, createdBy: ctx.adminId })
    .returning();

  await logEvent({
    type: "admin_action",
    actor: `admin:${ctx.adminId}`,
    userId: ctx.adminId,
    email: ctx.adminEmail,
    message: `${ctx.adminEmail} posted the announcement "${input.title}"`,
    detail: { announcementId: created.id, severity: input.severity, active: input.active },
  });

  return created;
}

export async function updateAnnouncement(
  id: string,
  input: Partial<AnnouncementInput> & { resurface?: boolean },
  ctx: { adminId: string; adminEmail: string }
): Promise<Announcement | null> {
  const { resurface, ...fields } = input;

  const [updated] = await db
    .update(announcements)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(announcements.id, id))
    .returning();

  if (!updated) return null;

  /**
   * Optionally show it to people who already dismissed it.
   *
   * Deliberately opt-in. Fixing a typo should not shove a banner back in front of everybody
   * who has already read and closed it — but genuinely new information in an existing notice
   * is exactly the case where it should reappear, and without this the only way to do that
   * would be to delete and repost.
   */
  if (resurface) {
    await db
      .delete(announcementDismissals)
      .where(eq(announcementDismissals.announcementId, id));
  }

  await logEvent({
    type: "admin_action",
    actor: `admin:${ctx.adminId}`,
    userId: ctx.adminId,
    email: ctx.adminEmail,
    message: `${ctx.adminEmail} updated the announcement "${updated.title}"`,
    detail: { announcementId: id, resurfaced: Boolean(resurface) },
  });

  return updated;
}

export async function deleteAnnouncement(
  id: string,
  ctx: { adminId: string; adminEmail: string }
): Promise<boolean> {
  const [deleted] = await db
    .delete(announcements)
    .where(eq(announcements.id, id))
    .returning({ title: announcements.title });

  if (!deleted) return false;

  await logEvent({
    type: "admin_action",
    actor: `admin:${ctx.adminId}`,
    userId: ctx.adminId,
    email: ctx.adminEmail,
    message: `${ctx.adminEmail} deleted the announcement "${deleted.title}"`,
    detail: { announcementId: id },
  });

  return true;
}

/**
 * Close a banner, for one person.
 *
 * `onConflictDoNothing` because a double-click, or two tabs, will send this twice, and the
 * second one is not an error — it is the same request arriving again.
 */
export async function dismissAnnouncement(announcementId: string, userId: string): Promise<void> {
  await db
    .insert(announcementDismissals)
    .values({ announcementId, userId })
    .onConflictDoNothing();
}
