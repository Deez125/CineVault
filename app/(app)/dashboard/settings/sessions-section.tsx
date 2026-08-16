"use client";

import { useActionState, useEffect, useTransition } from "react";
import { Loader2, LogOut, Monitor, Smartphone, Tablet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { revokeSessionAction } from "@/lib/auth/account-actions";
import type { FormState } from "@/lib/auth/actions";

export type SessionRow = {
  id: string;
  createdAt: string; // ISO — serialized across the server/client boundary
  refreshedAt: string | null;
  userAgent: string | null;
  ip: string | null;
  isCurrent: boolean;
};

/**
 * The "Signed-in devices" list on the settings page.
 *
 * Renders every active Supabase session for the member. Each non-current row has a "Sign
 * out" button that ends that session server-side. The current session is labelled and its
 * button is disabled — signing out here would be confusing (nothing tells you it happened)
 * and there is already a proper Sign out in the sidebar for that.
 */
export function SessionsSection({ sessions }: { sessions: SessionRow[] }) {
  if (sessions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No active sessions on file. That&apos;s unusual — try refreshing.
      </p>
    );
  }

  return (
    <ul className="divide-y">
      {sessions.map((session) => (
        <SessionItem key={session.id} session={session} />
      ))}
    </ul>
  );
}

function SessionItem({ session }: { session: SessionRow }) {
  const [state, formAction] = useActionState<FormState, FormData>(revokeSessionAction, null);
  const [pending, startTransition] = useTransition();
  const parsed = parseUserAgent(session.userAgent);

  useEffect(() => {
    if (state?.success) toast.success(state.success);
    if (state?.error) toast.error(state.error);
  }, [state]);

  const lastActive = session.refreshedAt ?? session.createdAt;

  return (
    <li className="flex items-center gap-3 py-3">
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
      >
        <parsed.Icon className="size-4" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <p className="truncate text-sm font-medium">{parsed.label}</p>
          {session.isCurrent && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
              This device
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {session.ip ? <span>{session.ip} · </span> : null}
          Last active {relativeTime(lastActive)}
        </p>
      </div>

      <form
        action={(formData) => {
          formData.set("sessionId", session.id);
          startTransition(() => formAction(formData));
        }}
      >
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          disabled={session.isCurrent || pending}
          aria-label={session.isCurrent ? "This is the current device" : "Sign out on this device"}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <>
              <LogOut className="mr-1.5 size-3.5" />
              Sign out
            </>
          )}
        </Button>
      </form>
    </li>
  );
}

/**
 * A pragmatic user-agent read: enough to tell "iPhone from Chrome-on-Mac" without pulling
 * in a full 100 KB parser. Falls back to "Unknown device" if the string is missing or the
 * regex misses.
 */
function parseUserAgent(ua: string | null) {
  if (!ua) return { label: "Unknown device", Icon: Monitor };

  const isTablet = /iPad|Tablet/i.test(ua);
  const isMobile = !isTablet && /Mobile|Android|iPhone|iPod/i.test(ua);

  const os = ua.match(/Windows NT|Mac OS X|iPhone OS|iPad|Android|Linux|CrOS/i)?.[0] ?? "";
  const browser =
    ua.match(/Edg|OPR|Chrome|Firefox|Safari/i)?.[0] ??
    ua.match(/[A-Za-z]+/)?.[0] ??
    "Browser";

  const osLabel: Record<string, string> = {
    "Windows NT": "Windows",
    "Mac OS X": "macOS",
    "iPhone OS": "iOS",
    iPad: "iPadOS",
    Android: "Android",
    Linux: "Linux",
    CrOS: "ChromeOS",
  };
  const browserLabel: Record<string, string> = {
    Edg: "Edge",
    OPR: "Opera",
    Chrome: "Chrome",
    Firefox: "Firefox",
    Safari: "Safari",
  };

  const parts = [browserLabel[browser] ?? browser, osLabel[os] ?? os].filter(Boolean);
  const label = parts.length ? parts.join(" on ") : "Unknown device";

  const Icon = isMobile ? Smartphone : isTablet ? Tablet : Monitor;
  return { label, Icon };
}

/** Human-readable "3 minutes ago" / "yesterday" / "3 days ago". */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "unknown";

  const diff = Date.now() - then;
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;

  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;

  const day = Math.round(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 30) return `${day} days ago`;

  return new Date(iso).toLocaleDateString();
}
