"use client";

import { useEffect, useRef, useState } from "react";
import type { PlexSession } from "@/lib/plex/sessions";

/**
 * The wire shape of GET /api/me/sessions. Duplicated from the route file rather than imported
 * — a client hook importing from a route file can drag server-only code (auth, DB, Plex
 * client) into the browser bundle even when the import is type-only, depending on how the
 * bundler resolves the surrounding module graph. A tiny type-only mirror is much cheaper.
 */
type MySessionsResponse = {
  mySessions: PlexSession[];
  allowance: { used: number; limit: number };
};

/**
 * Live "what am I watching" state for the dashboard panel.
 *
 * Polls /api/me/sessions on an interval, but ONLY while the tab is actually visible. A user
 * with the tab pinned in the background otherwise has their browser hammer Plex every few
 * seconds all day for something they cannot see — and multiplied across every open device it
 * turns into real load on the server.
 *
 * On a 503 (Plex unreachable this pass) the previous frame is kept. Blanking the panel would
 * flash "0 streams" every time Plex takes an extra second, which reads as a bug to somebody
 * mid-film.
 *
 * The first fetch runs immediately; subsequent ones on the interval. `initialLoading` stays
 * true only until that first response lands, so the panel gets one skeleton at open rather
 * than repeatedly on every poll.
 */

type UseMySessionsOptions = {
  /** Milliseconds between polls while the tab is visible. Default 10s. */
  intervalMs?: number;
  /** Whether polling is enabled at all — off for signed-out or non-member callers. */
  enabled?: boolean;
};

export type UseMySessionsResult = {
  sessions: PlexSession[];
  allowance: { used: number; limit: number } | null;
  initialLoading: boolean;
  error: string | null;
};

export function useMySessions(options: UseMySessionsOptions = {}): UseMySessionsResult {
  const { intervalMs = 10_000, enabled = true } = options;

  const [sessions, setSessions] = useState<PlexSession[]>([]);
  const [allowance, setAllowance] = useState<{ used: number; limit: number } | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // A ref, not state — flipping it from the visibility listener must not queue an extra render
  // just to change what the next poll does.
  const visibleRef = useRef(
    typeof document === "undefined" ? true : document.visibilityState === "visible"
  );

  useEffect(() => {
    if (!enabled) {
      setInitialLoading(false);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const fetchOnce = async () => {
      try {
        const res = await fetch("/api/me/sessions", { cache: "no-store" });

        // 503 = Plex unreachable this pass. Keep the previous frame; do not surface the
        // transient error to the UI (would flicker the panel on every poll during an outage).
        if (res.status === 503) return;

        if (!res.ok) {
          if (!cancelled) setError(`sessions request failed (${res.status})`);
          return;
        }

        const data = (await res.json()) as MySessionsResponse;
        if (cancelled) return;

        setSessions(data.mySessions);
        setAllowance(data.allowance);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "sessions request failed");
        }
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    };

    const schedule = () => {
      timer = setTimeout(async () => {
        if (cancelled) return;
        if (visibleRef.current) await fetchOnce();
        schedule();
      }, intervalMs);
    };

    // Immediate first poll so the panel populates on mount instead of after intervalMs.
    fetchOnce();
    schedule();

    const onVisibility = () => {
      const nowVisible = document.visibilityState === "visible";
      const wasHidden = !visibleRef.current;
      visibleRef.current = nowVisible;
      // Coming back from a background tab, refresh RIGHT NOW rather than waiting up to
      // intervalMs — the panel will otherwise show stale data from before the tab was hidden.
      if (nowVisible && wasHidden) void fetchOnce();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, intervalMs]);

  return { sessions, allowance, initialLoading, error };
}
