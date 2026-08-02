"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  CircleCheck,
  EllipsisVertical,
  LoaderCircle,
  RefreshCw,
  Send,
  ShieldOff,
  Unlink,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { UserListItem } from "@/lib/admin";
import { displayName } from "@/lib/display-name";

const money = (minor: number | null, currency: string | null) =>
  minor == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: (currency ?? "usd").toUpperCase(),
        minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
      }).format(minor / 100);

type Confirm = {
  user: UserListItem;
  action: "revoke" | "ban" | "unlink";
};

export function UsersTable({ users, selfId }: { users: UserListItem[]; selfId: string }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  async function run(user: UserListItem, action: string, body?: unknown) {
    setBusyId(user.id);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "That didn't work.");

      toast.success(describe(action, user, data));
      setConfirm(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusyId(null);
    }
  }

  if (users.length === 0) {
    return (
      <p className="rounded-xl border bg-card px-5 py-16 text-center text-sm text-muted-foreground">
        No accounts match.
      </p>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[52rem] text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
              <Th>Account</Th>
              <Th>Plan</Th>
              <Th>Plex</Th>
              <Th>Access</Th>
              <Th className="w-px" />
            </tr>
          </thead>

          <tbody className="divide-y">
            {users.map((user) => (
              <tr key={user.id} className="align-middle">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{displayName(user)}</span>
                    {user.isAdmin && <Tag>admin</Tag>}
                    {user.banned && <Tag tone="destructive">banned</Tag>}
                  </div>
                  <div className="text-xs text-muted-foreground">{user.email}</div>
                </td>

                <td className="px-4 py-3">
                  {user.isMember ? (
                    <>
                      <div>
                        {user.streamLimit} user{user.streamLimit === 1 ? "" : "s"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {money(user.subAmount, user.subCurrency)}
                        {user.subCancelAtPeriodEnd && " · cancelling"}
                      </div>
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      {user.subStatus ?? "none"}
                    </span>
                  )}
                </td>

                <td className="px-4 py-3">
                  {user.plexUsername ? (
                    <span>{user.plexUsername}</span>
                  ) : (
                    <span className="text-muted-foreground">not linked</span>
                  )}
                </td>

                <td className="px-4 py-3">
                  <AccessCell user={user} />
                </td>

                <td className="px-2 py-3">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="flex size-8 items-center justify-center rounded-lg outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                      aria-label={`Actions for ${user.email}`}
                      disabled={busyId === user.id}
                    >
                      {busyId === user.id ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <EllipsisVertical className="size-4" />
                      )}
                    </DropdownMenuTrigger>

                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuItem onClick={() => run(user, "reconcile")}>
                        <RefreshCw />
                        Re-check against Stripe
                      </DropdownMenuItem>

                      {user.isMember && user.plexUsername && (
                        <DropdownMenuItem onClick={() => run(user, "reinvite")}>
                          <Send />
                          Re-send Plex invite
                        </DropdownMenuItem>
                      )}

                      {user.plexUsername && (
                        <DropdownMenuItem
                          onClick={() => setConfirm({ user, action: "unlink" })}
                        >
                          <Unlink />
                          Unlink Plex
                        </DropdownMenuItem>
                      )}

                      <DropdownMenuSeparator />

                      {/* An admin revoking or banning themselves would lock the door with the
                          keys inside. The API refuses it too. */}
                      {user.id !== selfId && (
                        <>
                          {user.isMember && (
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setConfirm({ user, action: "revoke" })}
                            >
                              <ShieldOff />
                              Revoke now
                            </DropdownMenuItem>
                          )}

                          {user.banned ? (
                            <DropdownMenuItem onClick={() => run(user, "unban")}>
                              <CircleCheck />
                              Lift ban
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setConfirm({ user, action: "ban" })}
                            >
                              <Ban />
                              Ban
                            </DropdownMenuItem>
                          )}
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        key={confirm ? `${confirm.action}-${confirm.user.id}` : "none"}
        confirm={confirm}
        busy={busyId !== null}
        onCancel={() => setConfirm(null)}
        onConfirm={(reason) =>
          confirm && run(confirm.user, confirm.action, reason ? { reason } : undefined)
        }
      />
    </>
  );
}

function AccessCell({ user }: { user: UserListItem }) {
  if (user.banned) return <Tag tone="destructive">no access</Tag>;
  if (!user.isMember) return <span className="text-muted-foreground">none</span>;
  if (user.shareState === "invited") return <Tag tone="success">shared</Tag>;
  if (!user.plexUsername) return <Tag tone="warning">needs link</Tag>;
  return <Tag tone="warning">pending</Tag>;
}

function Tag({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "success" | "warning" | "destructive";
}) {
  const tones = {
    muted: "bg-muted text-muted-foreground ring-border",
    success: "bg-success/10 text-success ring-success/25",
    warning: "bg-warning/10 text-warning ring-warning/25",
    destructive: "bg-destructive/10 text-destructive ring-destructive/25",
  };

  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        tones[tone]
      )}
    >
      {children}
    </span>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn("px-4 py-2.5 font-medium", className)}>{children}</th>;
}

const COPY = {
  revoke: {
    title: "Revoke access now?",
    body: "Their subscription is cancelled immediately with no remaining paid period, and their Plex access is removed. This is not a refund.",
    confirm: "Revoke now",
  },
  ban: {
    title: "Ban this account?",
    body: "Their subscription is cancelled, access is removed, and they get nothing even if they pay again. They're signed out everywhere.",
    confirm: "Ban",
  },
  unlink: {
    title: "Unlink their Plex account?",
    body: "The share is removed first, then the account is detached. They can link a different one themselves.",
    confirm: "Unlink",
  },
} as const;

function ConfirmDialog({
  confirm,
  busy,
  onCancel,
  onConfirm,
}: {
  confirm: Confirm | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason?: string) => void;
}) {
  const [reason, setReason] = useState("");
  const copy = confirm ? COPY[confirm.action] : null;

  return (
    <Dialog open={Boolean(confirm)} onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy?.title}</DialogTitle>
          <DialogDescription>{copy?.body}</DialogDescription>
        </DialogHeader>

        {confirm && (
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <div className="font-medium">{confirm.user.email}</div>
            {confirm.user.plexUsername && (
              <div className="text-xs text-muted-foreground">
                Plex: {confirm.user.plexUsername}
              </div>
            )}
          </div>
        )}

        {confirm?.action === "ban" && (
          <div className="space-y-2">
            <Label htmlFor="reason">Reason (optional, internal)</Label>
            <Input
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              placeholder="Sharing their account"
            />
          </div>
        )}

        <DialogFooter>
          <DialogClose
            render={
              <Button variant="secondary" size="lg" disabled={busy}>
                Never mind
              </Button>
            }
          />
          <Button
            variant="destructive"
            size="lg"
            disabled={busy}
            onClick={() => onConfirm(reason.trim() || undefined)}
          >
            {busy && <LoaderCircle className="animate-spin" />}
            {copy?.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function describe(action: string, user: UserListItem, data: Record<string, unknown>): string {
  switch (action) {
    case "revoke":
      return `Revoked ${user.email}.`;
    case "ban":
      return `Banned ${user.email}.`;
    case "unban":
      return `Lifted the ban on ${user.email}.`;
    case "reinvite":
      return `Re-sent the Plex invite to ${user.plexUsername}.`;
    case "unlink":
      return `Unlinked Plex from ${user.email}.`;
    case "reconcile":
      return data.changed
        ? `${user.email} was out of step and has been corrected.`
        : `${user.email} already matches Stripe.`;
    default:
      return "Done.";
  }
}
