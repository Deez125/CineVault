import { plexSectionIds } from "@/lib/env";
import { listSections } from "./client";
import { forgetServerUri, serverJson } from "./server";

/**
 * What has just landed on the server.
 *
 * Read from the SHARED libraries only. Announcing a 4K title to somebody whose plan does not
 * include that library is an advert for something they cannot watch, and the fastest way to
 * generate a support ticket that has no good answer.
 */

export type RecentItem = {
  /** Plex's ratingKey. Stable until an item is removed and re-added. */
  id: string;
  /** movie | show | season | episode */
  type: string;
  title: string;
  /** For an episode: the series it belongs to. */
  showTitle: string | null;
  /** "S2 E4", when it is an episode. */
  episodeLabel: string | null;
  year: number | null;
  summary: string | null;
  /** Plex path for the poster. Never a full URL: it has to be proxied. See the image route. */
  thumb: string | null;
  addedAt: number;
  library: string;
  /**
   * Episodes can spoil. A title like "Ned Stark Dies" on somebody's dashboard is a bad
   * surprise, so the UI hides these until they ask to see them.
   */
  spoilery: boolean;
  /**
   * How many episodes of this show landed together. 1 for films and for a lone episode.
   *
   * A season drop is a dozen rows with the same poster, which turns the strip into wallpaper
   * and pushes everything else off the end of it. Collapsed, it says the one thing a member
   * actually wants: this show has new episodes.
   */
  episodeCount: number;
};

type PlexMetadata = {
  ratingKey: string;
  type: string;
  title: string;
  parentTitle?: string;
  grandparentTitle?: string;
  parentIndex?: number;
  index?: number;
  year?: number;
  summary?: string;
  thumb?: string;
  grandparentThumb?: string;
  parentThumb?: string;
  addedAt: number;
  librarySectionTitle?: string;
};

const PER_SECTION = 12;

/**
 * The newest items across every shared library, newest first.
 *
 * Queried per library rather than through the server's global recentlyAdded, because the
 * global list has no way to exclude the libraries we do not share — it would have to be
 * fetched in full and filtered, and it is capped, so a busy 4K library could push everything
 * shared off the end of it.
 */
export async function fetchRecentlyAdded(limit = 24): Promise<RecentItem[]> {
  const sections = await listSections();
  const sharedIds = new Set(plexSectionIds());

  // The env var holds library KEYS, which is what the SERVER wants; plex.tv wanted ids. Both
  // are accepted here for the same reason resolveSectionIds accepts both.
  const shared = sections.filter((s) => sharedIds.has(s.key) || sharedIds.has(s.id));

  const collected: RecentItem[] = [];

  for (const section of shared) {
    try {
      const data = await serverJson<{ MediaContainer?: { Metadata?: PlexMetadata[] } }>(
        `/library/sections/${section.key}/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=${PER_SECTION}`
      );

      for (const entry of data.MediaContainer?.Metadata ?? []) {
        collected.push(normalise(entry, section.title));
      }
    } catch (err) {
      // One unreachable library must not empty the whole strip. The connection is dropped so
      // the next attempt re-resolves it, in case the server simply moved.
      forgetServerUri();
      console.error(`[recently-added] ${section.title} failed:`, err instanceof Error ? err.message : err);
    }
  }

  return collapseEpisodes(collected.sort((a, b) => b.addedAt - a.addedAt)).slice(0, limit);
}

/**
 * One card per show, however many episodes arrived.
 *
 * Films are left alone. Episodes are grouped by series, keeping the newest as the
 * representative and counting the rest, so a season drop reads as "12 new episodes" rather
 * than twelve identical posters.
 */
function collapseEpisodes(items: RecentItem[]): RecentItem[] {
  const out: RecentItem[] = [];
  const seenShows = new Map<string, RecentItem>();

  for (const item of items) {
    if (item.type !== "episode" || !item.showTitle) {
      out.push(item);
      continue;
    }

    const existing = seenShows.get(item.showTitle);

    if (existing) {
      existing.episodeCount += 1;
      continue;
    }

    // Already sorted newest first, so the first one seen is the newest.
    seenShows.set(item.showTitle, item);
    out.push(item);
  }

  return out;
}

function normalise(entry: PlexMetadata, libraryTitle: string): RecentItem {
  const isEpisode = entry.type === "episode";
  const isSeason = entry.type === "season";

  return {
    id: entry.ratingKey,
    type: entry.type,
    title: entry.title,
    showTitle: entry.grandparentTitle ?? (isSeason ? (entry.parentTitle ?? null) : null),
    episodeLabel:
      isEpisode && entry.parentIndex != null && entry.index != null
        ? `S${entry.parentIndex} E${entry.index}`
        : null,
    year: entry.year ?? null,
    summary: entry.summary?.trim() || null,
    // For an episode the series poster is the recognisable one; an episode still is usually
    // a dark frame nobody can identify.
    thumb: entry.grandparentThumb ?? entry.parentThumb ?? entry.thumb ?? null,
    addedAt: entry.addedAt,
    library: entry.librarySectionTitle ?? libraryTitle,
    spoilery: isEpisode,
    episodeCount: 1,
  };
}
