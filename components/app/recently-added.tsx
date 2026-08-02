"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Eye, Film, Sparkles, Tv } from "lucide-react";
import { useRef } from "react";
import { cn } from "@/lib/utils";

export type RecentCard = {
  id: string;
  type: string;
  title: string;
  showTitle: string | null;
  episodeLabel: string | null;
  year: number | null;
  thumb: string | null;
  library: string;
  spoilery: boolean;
  episodeCount: number;
};

/**
 * What has just landed, as a poster strip.
 *
 * Episodes are covered by default. A title like "Ned Stark Dies" sitting on somebody's
 * dashboard is a spoiler they never asked for, and the person most likely to be caught by it
 * is the one working through the series right now. The series name and the episode number
 * stay visible, because those are what make it useful; only the episode's own title is
 * hidden, and one click reveals the lot.
 */
export function RecentlyAdded({ items }: { items: RecentCard[] }) {
  const rail = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-dashed bg-card/50 px-5 py-8 text-sm text-muted-foreground">
        <Sparkles className="size-4 shrink-0" />
        New films and episodes will appear here shortly after they land on the server.
      </div>
    );
  }

  const scroll = (direction: -1 | 1) => {
    rail.current?.scrollBy({ left: direction * 480, behavior: "smooth" });
  };

  return (
    <div className="group/rail relative">
      <div
        ref={rail}
        className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]"
      >
        {items.map((item) => {
          const hidden = item.spoilery && !revealed.has(item.id);

          return (
            <article key={item.id} className="w-[8.5rem] shrink-0 sm:w-[9.5rem]">
              <div className="relative aspect-[2/3] overflow-hidden rounded-lg border bg-muted">
                {item.thumb ? (
                  // Proxied, never a direct Plex URL: those carry the owner token.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/plex/image?path=${encodeURIComponent(item.thumb)}&w=300`}
                    alt=""
                    loading="lazy"
                    className="size-full object-cover"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center text-muted-foreground">
                    {item.type === "movie" ? <Film className="size-6" /> : <Tv className="size-6" />}
                  </div>
                )}

                {item.episodeCount > 1 ? (
                  <span className="absolute left-1.5 top-1.5 rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                    {item.episodeCount} new
                  </span>
                ) : (
                  item.episodeLabel && (
                    <span className="absolute left-1.5 top-1.5 rounded bg-background/85 px-1.5 py-0.5 text-[10px] font-medium">
                      {item.episodeLabel}
                    </span>
                  )
                )}
              </div>

              <div className="mt-2">
                {/* The series name is never hidden — it is what tells you whether this is
                    even your show. */}
                <p className="truncate text-xs font-medium" title={item.showTitle ?? item.title}>
                  {item.showTitle ?? item.title}
                </p>

                {/* Several episodes at once: the count says everything useful and there is
                    no single title to spoil. */}
                {item.showTitle && item.episodeCount > 1 ? (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {item.episodeCount} new episodes
                  </p>
                ) : item.showTitle ? (
                  hidden ? (
                    <button
                      onClick={() =>
                        setRevealed((current) => new Set(current).add(item.id))
                      }
                      className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Eye className="size-3" />
                      Show title
                    </button>
                  ) : (
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={item.title}>
                      {item.title}
                    </p>
                  )
                ) : (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {item.year ?? item.library}
                  </p>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {/* Arrows on hover, for anybody without a trackpad. The rail scrolls natively too. */}
      <ScrollButton side="left" onClick={() => scroll(-1)} />
      <ScrollButton side="right" onClick={() => scroll(1)} />
    </div>
  );
}

function ScrollButton({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;

  return (
    <button
      onClick={onClick}
      aria-label={side === "left" ? "Scroll left" : "Scroll right"}
      className={cn(
        "absolute top-[38%] hidden size-8 -translate-y-1/2 items-center justify-center rounded-full border bg-card shadow-md transition-opacity",
        "opacity-0 group-hover/rail:opacity-100 focus-visible:opacity-100",
        "md:flex",
        side === "left" ? "-left-3" : "-right-3"
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}
