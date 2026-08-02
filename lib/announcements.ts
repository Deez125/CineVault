import { and, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
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

export type UserAnnouncements = {
  /** Showing now. */
  visible: Announcement[];
  /** Closed by this person, but still live. Reachable behind the collapsed pill. */
  dismissed: Announcement[];
};

/**
 * Every live announcement for this user, split by whether they have closed it.
 *
 * Both halves are returned rather than just the visible ones, because closing a notice should
 * put it out of the way — not destroy it. Somebody who dismisses "server down Sunday" and then
 * wants to check the time needs a way back to it, and "wait for the admin to repost" is not a
 * way back.
 *
 * One query with a LEFT JOIN, split in JS. Two queries would be two round trips for something
 * that is one question, and the split itself is trivial.
 */
export async function listForUser(userId: string): Promise<UserAnnouncements> {
  const now = new Date();

  const rows = await db
    .select({
      announcement: announcements,
      dismissedAt: announcementDismissals.dismissedAt,
    })
    .from(announcements)
    .leftJoin(
      announcementDismissals,
      and(
        eq(announcementDismissals.announcementId, announcements.id),
        eq(announcementDismissals.userId, userId)
      )
    )
    .where(
      and(
        eq(announcements.active, true),
        or(isNull(announcements.startsAt), lte(announcements.startsAt, now)),
        or(isNull(announcements.endsAt), gte(announcements.endsAt, now))
      )
    )
    .orderBy(desc(announcements.createdAt))
    .limit(20);

  return {
    visible: rows.filter((r) => !r.dismissedAt).map((r) => r.announcement),
    dismissed: rows.filter((r) => r.dismissedAt).map((r) => r.announcement),
  };
}

/** Put a dismissed announcement back. The inverse of dismissing it. */
export async function restoreAnnouncement(announcementId: string, userId: string): Promise<void> {
  await db
    .delete(announcementDismissals)
    .where(
      and(
        eq(announcementDismissals.announcementId, announcementId),
        eq(announcementDismissals.userId, userId)
      )
    );
}

/** Everything, for the admin list. Includes off and expired ones. */
export async function listAll(): Promise<(Announcement & { dismissals: number })[]> {
  const rows = await db
    .select({
      announcement: announcements,
      // The outer column is written out in full ON PURPOSE. Drizzle emits an UNQUALIFIED
      // name for ${announcements.id} inside a subquery, so it resolves against the subquery's
      // own table first. This one happens to work because announcement_dismissals has no `id`
      // column to shadow it — which is luck, not design, and the identical pattern on tickets
      // failed outright because ticket_messages does have one.
      dismissals: sql<number>`(
        select count(*) from ${announcementDismissals}
        where ${announcementDismissals.announcementId} = ${sql.raw(`"announcements"."id"`)}
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
