"use client";

import { Film, MonitorPlay, Pause, Play, Signal, Tv } from "lucide-react";
import { useMySessions, type UseMySessionsResult } from "@/hooks/use-my-sessions";
import type { PlexSession } from "@/lib/plex/sessions";
import { isUnlimited } from "@/lib/plans";
import { cn } from "@/lib/utils";

/**
 * The "what you're watching right now" panel on /dashboard/plex.
 *
 * A rich card per stream — poster, title with year or S/E, progress bar and timestamp, the
 * device, the location, the quality, and a "transcoding" note when the server is having to
 * convert video on the fly. All live via useMySessions.
 *
 * Deliberately absent:
 *   - No kill button. Streams stop by pressing stop on the device they are playing on. The
 *     enforcer stops streams that break the plan limit; that is not a member's UI to have.
 *   - No username. There is no need — the panel already only shows the caller's own streams,
 *     and putting the name back in the card serves no purpose.
 *   - No "CineVault (Server 1)" label. That name appears elsewhere on the page and repeating
 *     it on every card would be noise.
 */

export function SessionsPanel({
  isMember,
  streamLimit,
  data,
}: {
  isMember: boolean;
  /** Their plan's stream allowance. Rendered as x/y unless they are unlimited (admin). */
  streamLimit: number;
  /**
   * Externally-fetched data, when the parent is already running useMySessions (as the Plex
   * page does, to feed the live "x/y" Stat in its header). When absent, the panel polls for
   * itself — the default for anywhere else the panel is dropped in.
   */
  data?: UseMySessionsResult;
}) {
  const own = useMySessions({ enabled: isMember && !data });
  const { sessions, allowance, initialLoading, error } = data ?? own;

  // Non-members don't get the section at all — no plan, no allowance, no reason to poll.
  if (!isMember) return null;

  const limit = allowance?.limit ?? streamLimit;
  const used = allowance?.used ?? sessions.length;
  const unlimited = isUnlimited(limit);

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <MonitorPlay className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Watching now</h2>
        </div>

        <div className="flex items-center gap-1.5 text-sm font-medium tabular-nums">
          <LiveDot active={used > 0} />
          <span>
            {unlimited ? (
              <>
                {used} <span className="text-muted-foreground">active</span>
              </>
            ) : (
              <>
                <span className={cn(used === 0 && "text-muted-foreground")}>{used}</span>
                <span className="text-muted-foreground">/{limit}</span>
              </>
            )}
          </span>
        </div>
      </header>

      {initialLoading ? (
        <div className="flex items-center justify-center px-5 py-14 text-sm text-muted-foreground">
          Loading…
        </div>
      ) : sessions.length === 0 ? (
        <EmptyState error={error} />
      ) : (
        <ul className="divide-y">
          {sessions.map((s) => (
            <SessionCard key={s.sessionId} session={s} />
          ))}
        </ul>
      )}
    </section>
  );
}

function SessionCard({ session }: { session: PlexSession }) {
  const isEpisode = session.mediaType === "episode";
  const percent = progressPercent(session.positionMs, session.durationMs);

  // Cover: prefer the episode still for TV, else the movie poster. The proxy allowlist only
  // accepts /library/metadata/{id}/thumb/{version}, so anything else is null → placeholder.
  const posterSrc = session.thumbPath
    ? `/api/plex/image?path=${encodeURIComponent(session.thumbPath)}&w=${isEpisode ? 320 : 200}`
    : null;

  const primary = isEpisode ? session.showTitle ?? session.title ?? "Playing" : session.title ?? "Playing";
  const secondary = isEpisode
    ? formatEpisode(session.seasonNumber, session.episodeNumber, session.title)
    : session.year != null
      ? String(session.year)
      : null;

  return (
    <li className="flex gap-4 p-4 sm:p-5">
      <div
        className={cn(
          "relative shrink-0 overflow-hidden rounded-md border bg-muted",
          // Episodes use their landscape still (16:9); movies use their poster (2:3).
          isEpisode ? "aspect-video w-32 sm:w-40" : "aspect-[2/3] w-20 sm:w-24"
        )}
      >
        {posterSrc ? (
          // Server-side proxied so the Plex token never leaves us.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={posterSrc} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            {isEpisode ? <Tv className="size-5" /> : <Film className="size-5" />}
          </div>
        )}

        {session.state === "paused" && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-[1px]">
            <Pause className="size-6 text-foreground drop-shadow" fill="currentColor" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold" title={primary}>
              {primary}
            </p>
            {secondary && (
              <p className="mt-0.5 truncate text-xs text-muted-foreground" title={secondary}>
                {secondary}
              </p>
            )}
          </div>

          <StatePill state={session.state} />
        </div>

        {/* Progress bar sits under the title, followed by timestamps. Only rendered when we
            have a duration to measure against — a stream still buffering has neither, and a
            zero-width bar in that gap would be a lie about how far in they are. */}
        {session.durationMs != null && session.durationMs > 0 && (
          <div className="mt-3">
            <div className="h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-[width] duration-500"
                style={{ width: `${percent}%` }}
                aria-hidden
              />
            </div>
            <div className="mt-1 flex justify-between text-[11px] tabular-nums text-muted-foreground">
              <span>{formatDuration(session.positionMs ?? 0)}</span>
              <span>{formatDuration(session.durationMs)}</span>
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {session.device && (
            <MetaItem icon={<MonitorPlay className="size-3.5" />} label={session.device} />
          )}
          {session.resolution && (
            <MetaItem
              icon={<Signal className="size-3.5" />}
              label={formatResolution(session.resolution)}
            />
          )}
        </div>
      </div>
    </li>
  );
}

function StatePill({ state }: { state: string }) {
  if (state === "playing") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success ring-1 ring-inset ring-success/25">
        <Play className="size-3" fill="currentColor" />
        Playing
      </span>
    );
  }
  if (state === "paused") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground ring-1 ring-inset ring-border">
        <Pause className="size-3" fill="currentColor" />
        Paused
      </span>
    );
  }
  if (state === "buffering") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning ring-1 ring-inset ring-warning/25">
        Buffering
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground ring-1 ring-inset ring-border">
      {state || "Unknown"}
    </span>
  );
}

function LiveDot({ active }: { active: boolean }) {
  return (
    <span className="relative flex size-2">
      {active && (
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
      )}
      <span
        className={cn(
          "relative inline-flex size-2 rounded-full",
          active ? "bg-success" : "bg-muted-foreground/40"
        )}
      />
    </span>
  );
}

function MetaItem({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-muted-foreground/70">{icon}</span>
      <span>{label}</span>
    </span>
  );
}

function EmptyState({ error }: { error: string | null }) {
  return (
    <div className="flex flex-col items-center gap-1 px-5 py-10 text-center">
      <p className="text-sm text-muted-foreground">
        {error ? "Couldn't check right now." : "Nothing playing right now."}
      </p>
      {!error && (
        <p className="text-xs text-muted-foreground/80">
          Streams appear here the moment they start.
        </p>
      )}
    </div>
  );
}

// ── formatting helpers ────────────────────────────────────────────────────────

function progressPercent(position: number | null, duration: number | null): number {
  if (position == null || duration == null || duration <= 0) return 0;
  return Math.max(0, Math.min(100, (position / duration) * 100));
}

/** "1:23:45" for feature films, "23:45" for episodes. Hours are dropped when zero. */
function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

function formatEpisode(
  season: number | null,
  episode: number | null,
  title: string | null
): string | null {
  const parts: string[] = [];
  if (season != null && episode != null) parts.push(`S${season} · E${episode}`);
  else if (episode != null) parts.push(`E${episode}`);
  if (title) parts.push(title);
  return parts.length ? parts.join(" · ") : null;
}

/** "1080" → "1080p", "4k" → "4K", "sd" → "SD". Verbatim otherwise. */
function formatResolution(res: string): string {
  const normal = res.toLowerCase();
  if (normal === "4k") return "4K";
  if (normal === "sd") return "SD";
  if (/^\d+$/.test(normal)) return `${normal}p`;
  return res;
}
