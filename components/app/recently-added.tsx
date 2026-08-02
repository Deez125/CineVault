"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight, Film, Sparkles, Tv } from "lucide-react";
import { cn } from "@/lib/utils";

export type RecentCard = {
  id: string;
  /** movie | show */
  type: string;
  title: string;
  year: number | null;
  thumb: string | null;
};

/**
 * What has just landed, as a poster strip.
 *
 * One card per title: a film, or a series. Never an episode — a season drop would otherwise
 * be a dozen identical posters, and somebody scanning a dashboard wants to know which SHOWS
 * have something new, not which episodes.
 */
export function RecentlyAdded({ items }: { items: RecentCard[] }) {
  const rail = useRef<HTMLDivElement>(null);

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-dashed bg-card/50 px-5 py-8 text-sm text-muted-foreground">
        <Sparkles className="size-4 shrink-0" />
        New films and shows will appear here shortly after they land on the server.
      </div>
    );
  }

  const scroll = (direction: -1 | 1) => {
    rail.current?.scrollBy({ left: direction * 480, behavior: "smooth" });
  };

  return (
    <div className="group/rail relative">
      <div ref={rail} className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]">
        {items.map((item) => (
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
            </div>

            <p className="mt-2 truncate text-xs font-medium" title={item.title}>
              {item.title}
            </p>
            {item.year && <p className="text-[11px] text-muted-foreground">{item.year}</p>}
          </article>
        ))}
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
