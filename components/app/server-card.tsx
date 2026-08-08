import Link from "next/link";
import { CircleCheck, CircleDashed, ExternalLink, Link2, ShieldCheck } from "lucide-react";
// The Plex mark, same as the "Sign in with Plex" button uses.
import { FaAngleRight } from "react-icons/fa";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { User } from "@/lib/db/schema";
import { formatStreamLimit } from "@/lib/plans";

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
  // Admins are on by their flag, without paying and without waiting for applyEntitlement to
  // have written is_member. Checked first for the same reason as everywhere else: the column
  // is derived and can lag, the allowlist cannot.
  if (user.isAdmin) {
    // They own the server. There is no share to wait for, so linking Plex is the only thing
    // that could still be outstanding.
    return user.plexUsername ? "ready" : "unlinked";
  }

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
            {user.isAdmin
              ? "Unlimited at a time"
              : user.isMember
                ? `${formatStreamLimit(user.streamLimit)} at a time`
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
          {user.isAdmin ? (
            <span className="flex items-center gap-1.5 font-medium">
              <ShieldCheck className="size-4 text-success" />
              Admin
            </span>
          ) : user.isMember ? (
            <span className="font-medium">{formatStreamLimit(user.streamLimit)}</span>
          ) : (
            <span className="text-muted-foreground">None</span>
          )}
        </Row>

        <Row label="Plex account">
          {user.plexUsername ? (
            // min-w-0 + truncate because this is the one value here that somebody else
            // chose the length of. A thirty-character Plex username is wider than the space
            // left beside the label on a phone, and without this it pushes the row out.
            <span className="flex min-w-0 items-center gap-1.5 font-medium">
              <CircleCheck className="size-4 shrink-0 text-success" />
              <span className="truncate">{user.plexUsername}</span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <CircleDashed className="size-4" />
              Not linked
            </span>
          )}
        </Row>

        <Row label="Library access">
          {user.isAdmin ? (
            <span className="font-medium">You own this server</span>
          ) : status === "ready" ? (
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
        {status === "inactive" && !user.isAdmin && (
          <Button size="lg" className="w-full sm:w-auto" render={<Link href="/dashboard/billing" />}>
            Choose a plan
          </Button>
        )}

        {status === "unlinked" && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {user.isAdmin
                ? "Link your Plex account so the app knows who you are there."
                : "Link your Plex account and we'll invite you straight away."}
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
            className="w-full bg-plex text-plex-foreground hover:bg-plex/90 sm:w-auto"
            render={<a href="https://app.plex.tv" target="_blank" rel="noreferrer" />}
          >
            <FaAngleRight />
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
      <span className="shrink-0 text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
