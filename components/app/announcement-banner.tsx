"use client";

import { useState } from "react";
import { CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type BannerAnnouncement = {
  id: string;
  title: string;
  body: string | null;
  severity: string;
};

const TONES: Record<string, { wrap: string; icon: typeof Info; iconClass: string }> = {
  info: { wrap: "border-info/30 bg-info/5", icon: Info, iconClass: "text-info" },
  success: { wrap: "border-success/30 bg-success/5", icon: CircleCheck, iconClass: "text-success" },
  warning: {
    wrap: "border-warning/30 bg-warning/5",
    icon: TriangleAlert,
    iconClass: "text-warning",
  },
  destructive: {
    wrap: "border-destructive/30 bg-destructive/5",
    icon: TriangleAlert,
    iconClass: "text-destructive",
  },
};

/**
 * An admin notice on the dashboard.
 *
 * Hidden optimistically the moment it is closed, before the request finishes. Somebody who
 * clicks the X wants it gone; making them watch a spinner to dismiss a banner is worse than
 * the small risk that the write fails and it returns on the next load — which is also the
 * correct outcome if the write really did fail.
 */
export function AnnouncementBanner({
  announcement,
  /**
   * Render it exactly as members see it, but inert.
   *
   * Used by the admin list so what an admin is looking at IS the thing being posted, rather
   * than a separate approximation that drifts from it. The close button goes, because
   * dismissing a preview would hide the notice from the person managing it.
   */
  preview = false,
}: {
  announcement: BannerAnnouncement;
  preview?: boolean;
}) {
  const [dismissed, setDismissed] = useState(false);
  const tone = TONES[announcement.severity] ?? TONES.info;
  const Icon = tone.icon;

  if (dismissed) return null;

  return (
    <div className={cn("flex items-start gap-3 rounded-xl border p-4", tone.wrap)}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone.iconClass)} />

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{announcement.title}</p>
        {announcement.body && (
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
            {announcement.body}
          </p>
        )}
      </div>

      {!preview && (
        <button
          onClick={() => {
            setDismissed(true);
            void fetch(`/api/announcements/${announcement.id}/dismiss`, { method: "POST" });
          }}
          aria-label="Dismiss"
          className="-m-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
