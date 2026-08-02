import { plexSectionIds } from "@/lib/env";
import { listSections } from "./client";
import { forgetServerUri, serverJson } from "./server";

/**
 * What has just landed on the server.
 *
 * Read from the SHARED libraries only. Announcing a 4K title to somebody whose plan does not
 * include that library is an advert for something they cannot watch, and the fastest way to
 * generate a support ticket that has no good answer.
 *
 * A film is a card. A SERIES is a card — never an episode. Plex's recently-added returns
 * individual episodes, so a season drop would otherwise be twelve identical posters that push
 * every film off the end of the strip. Nobody scanning a dashboard wants a list of episodes;
 * they want to know which shows have something new.
 */

export type RecentItem = {
  /** Plex's ratingKey — the SERIES key for television, not the episode's. */
  id: string;
  /** movie | show */
  type: string;
  title: string;
  year: number | null;
  /** Plex path for the poster. Never a full URL: it has to be proxied. See the image route. */
  thumb: string | null;
  addedAt: number;
  library: string;
};

type PlexMetadata = {
  ratingKey: string;
  type: string;
  title: string;
  parentTitle?: string;
  grandparentTitle?: string;
  grandparentRatingKey?: string;
  parentRatingKey?: string;
  year?: number;
  thumb?: string;
  grandparentThumb?: string;
  parentThumb?: string;
  addedAt: number;
  librarySectionTitle?: string;
};

const PER_SECTION = 20;

/**
 * The newest films and series across every shared library, newest first.
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

  const collected: PlexMetadata[] = [];

  for (const section of shared) {
    try {
      const data = await serverJson<{ MediaContainer?: { Metadata?: PlexMetadata[] } }>(
        `/library/sections/${section.key}/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=${PER_SECTION}`
      );

      for (const entry of data.MediaContainer?.Metadata ?? []) {
        collected.push({ ...entry, librarySectionTitle: entry.librarySectionTitle ?? section.title });
      }
    } catch (err) {
      // One unreachable library must not empty the whole strip. The connection is dropped so
      // the next attempt re-resolves it, in case the server simply moved.
      forgetServerUri();
      console.error(
        `[recently-added] ${section.title} failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  collected.sort((a, b) => b.addedAt - a.addedAt);

  const items = collapse(collected).slice(0, limit);
  await fillShowYears(items);

  return items;
}

/**
 * One card per title.
 *
 * Films pass through. Anything belonging to a series — an episode or a season — becomes a
 * card for the SERIES, keyed on the series' own ratingKey so three episodes of one show
 * collapse into one entry rather than three.
 */
function collapse(entries: PlexMetadata[]): RecentItem[] {
  const out: RecentItem[] = [];
  const seenSeries = new Set<string>();

  for (const entry of entries) {
    const seriesKey = entry.grandparentRatingKey ?? (entry.type === "season" ? entry.parentRatingKey : undefined);
    const seriesTitle = entry.grandparentTitle ?? (entry.type === "season" ? entry.parentTitle : undefined);

    if (seriesKey && seriesTitle) {
      if (seenSeries.has(seriesKey)) continue;
      seenSeries.add(seriesKey);

      out.push({
        id: seriesKey,
        type: "show",
        title: seriesTitle,
        // Filled in below: an episode's `year` is the year that EPISODE aired, which is not
        // what "the year it came out" means for a series.
        year: null,
        // The series poster, not an episode still — a still is usually a dark frame nobody
        // can identify.
        thumb: entry.grandparentThumb ?? entry.parentThumb ?? entry.thumb ?? null,
        addedAt: entry.addedAt,
        library: entry.librarySectionTitle ?? "",
      });
      continue;
    }

    // A series added whole comes through as type "show" already.
    if (entry.type === "show") {
      if (seenSeries.has(entry.ratingKey)) continue;
      seenSeries.add(entry.ratingKey);
    }

    out.push({
      id: entry.ratingKey,
      type: entry.type === "show" ? "show" : "movie",
      title: entry.title,
      year: entry.year ?? null,
      thumb: entry.thumb ?? null,
      addedAt: entry.addedAt,
      library: entry.librarySectionTitle ?? "",
    });
  }

  return out;
}

/**
 * Look up the year each series first aired.
 *
 * One request per show, and only for the shows actually on the strip — at most a couple of
 * dozen, refreshed every ten minutes. A missing year is left null rather than failing the
 * whole strip: a card without a year is still a useful card.
 */
async function fillShowYears(items: RecentItem[]): Promise<void> {
  const shows = items.filter((item) => item.type === "show" && item.year === null);

  await Promise.all(
    shows.map(async (show) => {
      try {
        const data = await serverJson<{ MediaContainer?: { Metadata?: PlexMetadata[] } }>(
          `/library/metadata/${show.id}`
        );

        const meta = data.MediaContainer?.Metadata?.[0];
        if (meta?.year) show.year = meta.year;
        if (meta?.thumb) show.thumb = meta.thumb;
      } catch {
        // Leave the year null. Not worth failing the strip over.
      }
    })
  );
}
