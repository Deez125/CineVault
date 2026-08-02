import Link from "next/link";
import { CircleCheck, CircleDashed, ExternalLink, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { User } from "@/lib/db/schema";

/**
 * The service card.
 *
 * The one thing a member actually comes here to check: am I on, and can I watch. Everything
 * shown is real state from the database, so it is never more optimistic than the truth. In
 * particular "Ready" appears only once Plex has actually been shared, not merely once they
 * have paid, because a card that says everything is fine while they cannot open anything is
 * worse than one that says what is still missing.
 */

const SERVER_NAME = "CineVault (Server 1)";

type Status = "ready" | "pending" | "unlinked" | "inactive";

function statusOf(user: User): Status {
  if (!user.isMember) return "inactive";
  if (!user.plexUsername) return "unlinked";
  return user.shareState === "invited" ? "ready" : "pending";
}

const PRESENTATION: Record<Status, { label: string; tone: string; dot: string }> = {
  ready: {
    label: "RUNNING",
    tone: "bg-success/10 text-success ring-success/25",
    dot: "bg-success",
  },
  pending: {
    label: "SETTING UP",
    tone: "bg-warning/10 text-warning ring-warning/25",
    dot: "bg-warning",
  },
  unlinked: {
    label: "ACTION NEEDED",
    tone: "bg-warning/10 text-warning ring-warning/25",
    dot: "bg-warning",
  },
  inactive: {
    label: "INACTIVE",
    tone: "bg-muted text-muted-foreground ring-border",
    dot: "bg-muted-foreground",
  },
};

export function ServerCard({ user }: { user: User }) {
  const status = statusOf(user);
  const presentation = PRESENTATION[status];

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      {/* Flat. The border and the status badge already separate this from the rows below;
          a gradient behind them was decoration doing a job nothing needed doing. */}
      <div className="flex items-start justify-between gap-4 border-b bg-muted/30 p-5">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{SERVER_NAME}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {user.isMember
              ? `${user.streamLimit} user${user.streamLimit === 1 ? "" : "s"} at a time`
              : "No active plan"}
          </p>
        </div>

        <span
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide ring-1 ring-inset",
            presentation.tone
          )}
        >
          <span className={cn("size-1.5 rounded-full", presentation.dot)} />
          {presentation.label}
        </span>
      </div>

      <div className="divide-y">
        <Row label="Plan">
          {user.isMember ? (
            <span className="font-medium">
              {user.streamLimit} user{user.streamLimit === 1 ? "" : "s"}
            </span>
          ) : (
            <span className="text-muted-foreground">None</span>
          )}
        </Row>

        <Row label="Plex account">
          {user.plexUsername ? (
            <span className="flex items-center gap-1.5 font-medium">
              <CircleCheck className="size-4 text-success" />
              {user.plexUsername}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <CircleDashed className="size-4" />
              Not linked
            </span>
          )}
        </Row>

        <Row label="Library access">
          {status === "ready" ? (
            <span className="flex items-center gap-1.5 font-medium text-success">
              <CircleCheck className="size-4" />
              Shared with you
            </span>
          ) : status === "pending" ? (
            <span className="text-warning">Invite on its way</span>
          ) : (
            <span className="text-muted-foreground">Not yet</span>
          )}
        </Row>
      </div>

      {/* One action, chosen by whatever is actually blocking them. */}
      <div className="border-t bg-muted/30 p-4">
        {status === "inactive" && (
          <Button size="lg" className="w-full sm:w-auto" render={<Link href="/dashboard/billing" />}>
            Choose a plan
          </Button>
        )}

        {status === "unlinked" && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Link your Plex account and we&apos;ll invite you straight away.
            </p>
            <Button size="lg" render={<Link href="/dashboard/plex" />}>
              <Link2 />
              Link my Plex
            </Button>
          </div>
        )}

        {status === "pending" && (
          <p className="text-sm text-muted-foreground">
            Your invite is being set up. Check app.plex.tv in a minute.
          </p>
        )}

        {status === "ready" && (
          <Button
            size="lg"
            className="w-full sm:w-auto"
            render={<a href="https://app.plex.tv" target="_blank" rel="noreferrer" />}
          >
            Open Plex
            <ExternalLink />
          </Button>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
