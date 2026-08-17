"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Info, Plus, Ticket, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { generateAdminInviteAction, revokeAdminInviteAction } from "./actions";

/**
 * Client wrapper for the admin invites page — same shape as the member invite list, but
 * one important difference: no discount language anywhere. These invites bypass the
 * signup gate; that's their whole job. The rows do not talk about credit or half off.
 */

type Invite = {
  id: string;
  code: string;
  state: "unused" | "used" | "revoked" | "expired";
  createdAt: string;
  expiresAt: string;
  usedByEmail: string | null;
  usedAt: string | null;
};

const STATES: Record<
  Invite["state"],
  { label: string; dot: string; muted: boolean }
> = {
  unused: { label: "Waiting", dot: "bg-primary", muted: false },
  used: { label: "Joined", dot: "bg-success", muted: false },
  expired: { label: "Expired", dot: "bg-muted-foreground/40", muted: true },
  revoked: { label: "Revoked", dot: "bg-muted-foreground/40", muted: true },
};

export function AdminInvitesClient({
  invites,
  origin,
}: {
  invites: Invite[];
  origin: string;
}) {
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);

  const linkFor = (code: string) => `${origin}/signup?ref=${code}`;

  function mint() {
    start(async () => {
      const result = await generateAdminInviteAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setFresh(result.code);
      await navigator.clipboard.writeText(linkFor(result.code)).then(
        () => toast.success("Admin invite created and copied"),
        () => toast.success("Admin invite created")
      );
    });
  }

  function revoke(id: string) {
    start(async () => {
      const result = await revokeAdminInviteAction(id);
      if (result.ok) toast.success("Invite revoked.");
      else toast.error(result.error);
    });
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(linkFor(code));
      setCopied(code);
      setTimeout(() => setCopied(null), 1200);
    } catch {
      toast.error("Couldn't copy — try selecting the link manually.");
    }
  }

  return (
    <div className="space-y-5">
      {/* Explainer: exists because "admin invite" reads like a technical thing. Says what
          it is in one sentence, and what it does not do (no discount) in another. */}
      <div className="flex items-start gap-2.5 rounded-xl border bg-muted/30 p-4 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="text-muted-foreground">
          <p>
            An admin invite lets one person past the invite-only gate to create an account.
          </p>
          <p className="mt-1">
            Unlike a member referral, it doesn&apos;t give the recipient a discount and
            doesn&apos;t credit anyone. Use it to add specific people you know.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-5">
        <div>
          <p className="text-sm font-semibold">Generate a new invite</p>
          <p className="text-xs text-muted-foreground">
            One-time use, expires after 30 days. Copied to your clipboard automatically.
          </p>
        </div>
        <Button size="lg" onClick={mint} disabled={pending}>
          <Plus className="size-4" />
          Generate invite
        </Button>
      </div>

      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="border-b px-5 py-3.5">
          <h2 className="text-sm font-semibold">Your admin invites</h2>
        </div>

        {invites.length === 0 ? (
          <div className="flex items-center gap-3 px-5 py-10 text-sm text-muted-foreground">
            <Ticket className="size-4" />
            You haven&apos;t created any admin invites yet.
          </div>
        ) : (
          <ul className="divide-y">
            {invites.map((invite) => {
              const state = STATES[invite.state];
              const isFresh = fresh === invite.code;
              return (
                <li
                  key={invite.id}
                  className={cn(
                    "flex flex-wrap items-center gap-3 px-5 py-3.5",
                    state.muted && "opacity-60",
                    isFresh && "bg-primary/5"
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className={cn("size-2 shrink-0 rounded-full", state.dot)} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-mono text-sm font-medium">{invite.code}</span>
                        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                          {state.label}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {invite.state === "used" && invite.usedByEmail ? (
                          <>Joined by {invite.usedByEmail}</>
                        ) : invite.state === "unused" ? (
                          <>Expires {new Date(invite.expiresAt).toLocaleDateString()}</>
                        ) : (
                          <>Created {new Date(invite.createdAt).toLocaleDateString()}</>
                        )}
                      </p>
                    </div>
                  </div>

                  {invite.state === "unused" && (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => copy(invite.code)}
                        disabled={pending}
                      >
                        {copied === invite.code ? (
                          <>
                            <Check className="size-3.5" /> Copied
                          </>
                        ) : (
                          <>
                            <Copy className="size-3.5" /> Copy link
                          </>
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => revoke(invite.id)}
                        disabled={pending}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="size-3.5" />
                        Revoke
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
