"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { CircleCheck, Info, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { UserNotification } from "@/lib/db/schema";
import { dismissNotificationAction, type DismissState } from "./user-notifications-actions";

/**
 * The banner card list at the top of the user dashboard.
 *
 * One card per unread notification, styled by severity. Each card has a small X that fires
 * dismissNotificationAction — successful dismissal removes the card locally without a page
 * refresh, so the interaction feels immediate. The action's revalidatePath keeps the server
 * view in step for the next real navigation.
 *
 * Deliberately not styled to shout. These are one-line-plus-context updates from the admin,
 * not error alerts — they should read as friendly notes.
 */

// Client-side local dismissal so the card disappears immediately after the action succeeds,
// instead of waiting for a full route refresh.
export function UserNotifications({ notifications }: { notifications: UserNotification[] }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const visible = notifications.filter((n) => !dismissed.has(n.id));

  if (visible.length === 0) return null;

  return (
    <div className="space-y-2">
      {visible.map((n) => (
        <NotificationCard
          key={n.id}
          notification={n}
          onDismissed={() => setDismissed((prev) => new Set(prev).add(n.id))}
        />
      ))}
    </div>
  );
}

function NotificationCard({
  notification,
  onDismissed,
}: {
  notification: UserNotification;
  onDismissed: () => void;
}) {
  const [state, formAction] = useActionState<DismissState, FormData>(
    dismissNotificationAction,
    null
  );
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (state?.dismissed) {
      onDismissed();
    } else if (state?.error) {
      toast.error(state.error);
    }
  }, [state, onDismissed]);

  const tone = toneFor(notification.severity);
  const Icon = iconFor(notification.severity);

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border p-4",
        tone.container
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone.icon)} />

      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-medium", tone.title)}>{notification.title}</p>
        {notification.body && (
          <p className="mt-0.5 text-sm text-muted-foreground">{notification.body}</p>
        )}
      </div>

      <form
        action={(formData) => {
          formData.set("id", notification.id);
          startTransition(() => formAction(formData));
        }}
        className="shrink-0"
      >
        <button
          type="submit"
          disabled={pending}
          aria-label="Dismiss"
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground disabled:opacity-50"
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <X className="size-4" />
          )}
        </button>
      </form>
    </div>
  );
}

function iconFor(severity: string) {
  if (severity === "success") return CircleCheck;
  if (severity === "warning") return TriangleAlert;
  return Info;
}

function toneFor(severity: string): {
  container: string;
  icon: string;
  title: string;
} {
  switch (severity) {
    case "success":
      return {
        container: "border-success/30 bg-success/5",
        icon: "text-success",
        title: "text-foreground",
      };
    case "warning":
      return {
        container: "border-warning/30 bg-warning/5",
        icon: "text-warning",
        title: "text-foreground",
      };
    default:
      return {
        container: "border-primary/30 bg-primary/5",
        icon: "text-primary",
        title: "text-foreground",
      };
  }
}
