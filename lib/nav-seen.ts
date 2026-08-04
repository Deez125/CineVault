import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";

/**
 * Remembering which sidebar sections a member has opened.
 *
 * The dots need two different lifetimes, and one mechanism serves both:
 *
 *   BLUE  — "this is new to you". Shown until the section is opened, then never again.
 *   RED   — "somebody replied". Shown while the reply is newer than the last visit, so it
 *           comes back the next time something arrives rather than being dismissed forever.
 *
 * Which is why a timestamp is stored rather than a boolean. A flag could only ever answer the
 * first question.
 *
 * NOT a "use server" module. Marking a section seen happens when the PAGE renders, which is
 * server code already — and the directive would forbid exporting NAV_KEYS alongside it, since
 * a server-action file may only export async functions.
 */

/** The keys that can carry a dot. Hrefs, so the sidebar never has to translate. */
export const NAV_KEYS = [
  "/dashboard/plex",
  "/dashboard/referrals",
  "/dashboard/support",
  "/admin/support",
] as const;

export type NavKey = (typeof NAV_KEYS)[number];

function isNavKey(value: string): value is NavKey {
  return (NAV_KEYS as readonly string[]).includes(value);
}

/**
 * Record that the signed-in member just opened a section.
 *
 * The user comes from the SESSION and the key is validated against a fixed list, so this
 * cannot be used to write arbitrary JSON onto somebody else's row.
 *
 * Merges server-side with `||` rather than reading, spreading and writing back. Two tabs
 * marking different sections at the same moment would otherwise each write a whole object
 * built from what they read, and the slower one would silently undo the other.
 */
export async function markNavSeen(key: string): Promise<void> {
  if (!isNavKey(key)) return;

  const user = await getSessionUser();
  if (!user) return;

  await db
    .update(users)
    .set({
      navSeen: sql`${users.navSeen} || ${JSON.stringify({ [key]: new Date().toISOString() })}::jsonb`,
    })
    .where(eq(users.id, user.id));
}
