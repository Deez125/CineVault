"use client";

import { useState } from "react";
import { ChevronDown, Megaphone, RotateCcw, X } from "lucide-react";
import { toneOf } from "./announcement-tones";
import { cn } from "@/lib/utils";

export type BannerAnnouncement = {
  id: string;
  title: string;
  body: string | null;
  severity: string;
};

/**
 * Announcements on the dashboard, with the dismissed ones still reachable.
 *
 * Closing a notice should put it out of the way, not destroy it. Somebody who dismisses
 * "server down Sunday" and then wants to check the time needs a route back, and "wait for the
 * admin to repost it" is not one. So dismissed-but-still-live notices collapse into a small
 * pill that expands.
 *
 * State lives here rather than in each banner, so dismissing moves an item into the pill
 * immediately and the count updates without a page load. The request is fired and not waited
 * on: somebody who clicks X wants it gone now, and if the write fails the banner reappears on
 * the next load, which is the correct outcome anyway.
 */
export function Announcements({
  visible: initialVisible,
  dismissed: initialDismissed,
}: {
  visible: BannerAnnouncement[];
  dismissed: BannerAnnouncement[];
}) {
  const [visible, setVisible] = useState(initialVisible);
  const [dismissed, setDismissed] = useState(initialDismissed);
  const [open, setOpen] = useState(false);

  if (visible.length === 0 && dismissed.length === 0) return null;

  function dismiss(item: BannerAnnouncement) {
    setVisible((list) => list.filter((a) => a.id !== item.id));
    setDismissed((list) => [item, ...list]);
    void fetch(`/api/announcements/${item.id}/dismiss`, { method: "POST" });
  }

  function restore(item: BannerAnnouncement) {
    setDismissed((list) => list.filter((a) => a.id !== item.id));
    setVisible((list) => [item, ...list]);
    void fetch(`/api/announcements/${item.id}/restore`, { method: "POST" });
  }

  return (
    <div className="space-y-3">
      {visible.map((item) => (
        <Banner key={item.id} announcement={item} onDismiss={() => dismiss(item)} />
      ))}

      {dismissed.length > 0 && (
        <div>
          <button
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Megaphone className="size-3.5" />
            {dismissed.length} dismissed announcement{dismissed.length === 1 ? "" : "s"}
            <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
          </button>

          {open && (
            <div className="mt-2 space-y-2">
              {dismissed.map((item) => (
                <Banner
                  key={item.id}
                  announcement={item}
                  muted
                  onRestore={() => restore(item)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Banner({
  announcement,
  muted = false,
  preview = false,
  onDismiss,
  onRestore,
}: {
  announcement: BannerAnnouncement;
  /** Dimmed, for the ones already closed. Still readable, just clearly set aside. */
  muted?: boolean;
  preview?: boolean;
  onDismiss?: () => void;
  onRestore?: () => void;
}) {
  const tone = toneOf(announcement.severity);
  const Icon = tone.icon;

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border p-4 transition-opacity",
        tone.wrap,
        muted && "opacity-60 hover:opacity-100"
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone.icon_)} />

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{announcement.title}</p>
        {announcement.body && (
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
            {announcement.body}
          </p>
        )}
      </div>

      {!preview && onRestore && (
        <button
          onClick={onRestore}
          className="-m-1 flex shrink-0 items-center gap-1 rounded-md p-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <RotateCcw className="size-3.5" />
          Restore
        </button>
      )}

      {!preview && onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-m-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

/** The same banner, inert, for the admin list. What you write is what members get. */
export function AnnouncementPreview({ announcement }: { announcement: BannerAnnouncement }) {
  return <Banner announcement={announcement} preview />;
}
