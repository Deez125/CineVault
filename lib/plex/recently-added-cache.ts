import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { kv } from "@/lib/db/schema";
import { plexConfigured } from "@/lib/env";
import { fetchRecentlyAdded, type RecentItem } from "./recently-added";

/**
 * The recently-added list, cached in the database.
 *
 * The dashboard is the most-loaded page on the site, and the list changes a few times a day.
 * Asking Plex on every render would put a multi-second round trip in front of every visit and
 * hammer the server for an answer that is almost always the same.
 *
 * Refreshed by the worker. The read path NEVER refreshes — a page load that quietly triggers
 * a Plex fetch is a page load that is slow at random, and if Plex is down it would be slow and
 * then fail, for a strip that is decoration.
 */

const KEY = "recently_added";

type Cached = { items: RecentItem[]; refreshedAt: string };

export async function readRecentlyAdded(): Promise<RecentItem[]> {
  const [row] = await db.select().from(kv).where(eq(kv.key, KEY)).limit(1);
  if (!row) return [];

  const value = row.value as Cached;
  return Array.isArray(value?.items) ? value.items : [];
}

/** When the cache was last written, for the admin panel. */
export async function recentlyAddedRefreshedAt(): Promise<Date | null> {
  const [row] = await db.select().from(kv).where(eq(kv.key, KEY)).limit(1);
  return row ? row.updatedAt : null;
}

/**
 * Re-read from Plex and store.
 *
 * On failure the previous list is LEFT ALONE rather than cleared. A Plex hiccup should not
 * blank the strip on everybody's dashboard; yesterday's list is still true, just not fresh.
 */
export async function refreshRecentlyAdded(): Promise<{ items: number; skipped?: string }> {
  if (!plexConfigured()) return { items: 0, skipped: "plex not configured" };

  const items = await fetchRecentlyAdded();

  if (items.length === 0) {
    // Every library failed, or they are genuinely all empty. Either way, replacing a good
    // list with an empty one loses more than it gains.
    return { items: 0, skipped: "nothing returned" };
  }

  const value: Cached = { items, refreshedAt: new Date().toISOString() };

  await db
    .insert(kv)
    .values({ key: KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: kv.key, set: { value, updatedAt: new Date() } });

  return { items: items.length };
}
