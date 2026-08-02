"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Plus, Share2, Ticket, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import type { InviteView } from "@/lib/referrals";
import { generateLinkAction, revokeLinkAction } from "@/app/(app)/dashboard/referrals/actions";

/**
 * The invites, and the button that mints one.
 *
 * Each row is one link with one outcome, which is the point of the whole design: a member can
 * see that the invite they sent their brother in March is still sitting unused, rather than a
 * single number that never moved.
 */

const STATES: Record<
  InviteView["state"],
  { label: string; dot: string; muted: boolean }
> = {
  unused: { label: "Waiting", dot: "bg-primary", muted: false },
  used: { label: "Joined", dot: "bg-success", muted: false },
  expired: { label: "Expired", dot: "bg-muted-foreground/40", muted: true },
  revoked: { label: "Revoked", dot: "bg-muted-foreground/40", muted: true },
};

export function InviteList({
  invites,
  slotsLeft,
  cap,
  origin,
}: {
  invites: InviteView[];
  slotsLeft: number;
  cap: number;
  /** Passed in rather than read from the browser, so the link is right in an email too. */
  origin: string;
}) {
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);

  const linkFor = (code: string) => `${origin}/signup?ref=${code}`;

  function generate() {
    start(async () => {
      const result = await generateLinkAction();

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      if (result.code) {
        setFresh(result.code);
        // Straight to the clipboard. Generating one and then hunting for a copy button is a
        // step nobody wants; the toast says what happened so it is not silent magic.
        await navigator.clipboard.writeText(linkFor(result.code)).then(
          () => toast.success("Invite link created and copied"),
          () => toast.success("Invite link created")
        );
      }
    });
  }

  function revoke(id: string) {
    start(async () => {
      const result = await revokeLinkAction(id);
      if (result.ok) toast.success("Invite revoked. That slot is free again.");
      else toast.error(result.error);
    });
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(linkFor(code));
      setCopied(code);
      setTimeout(() => setCopied((c) => (c === code ? null : c)), 2000);
    } catch {
      toast.error("Couldn't copy. Select the link and copy it manually.");
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <div>
          <div className="text-sm font-medium">Your invites</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {slotsLeft > 0
              ? `${slotsLeft} of ${cap} left this month`
              : `All ${cap} used this month — revoke one, or wait for next month`}
          </div>
        </div>

        <Button onClick={generate} disabled={pending || slotsLeft <= 0}>
          <Plus />
          Generate invite link
        </Button>
      </div>

      {invites.length === 0 ? (
        <div className="px-5 py-16 text-center">
          <Ticket className="mx-auto size-6 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">
            No invites yet. Generate one and send it to somebody.
          </p>
        </div>
      ) : (
        <ul className="divide-y">
          {invites.map((invite) => {
            const state = STATES[invite.state];
            const live = invite.state === "unused";

            return (
              <li
                key={invite.id}
                className={cn(
                  "px-5 py-4 transition-colors",
                  invite.code === fresh && "bg-success/5",
                  state.muted && "opacity-60"
                )}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className={cn("size-2 shrink-0 rounded-full", state.dot)} />

                  <code
                    className={cn(
                      "font-mono text-sm tracking-widest",
                      state.muted && "line-through"
                    )}
                  >
                    {invite.code}
                  </code>

                  <span className="text-xs text-muted-foreground">{state.label}</span>

                  {invite.rewardAmount != null && (
                    <span className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                      +{formatMoney(invite.rewardAmount, invite.rewardCurrency ?? "usd")}
                    </span>
                  )}

                  <div className="ml-auto flex items-center gap-1">
                    {live && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copy(invite.code)}
                          aria-label="Copy invite link"
                        >
                          {copied === invite.code ? <Check /> : <Copy />}
                        </Button>

                        <ShareButton url={linkFor(invite.code)} />

                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() => revoke(invite.id)}
                          aria-label="Revoke invite"
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X />
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-1.5 pl-5 text-xs text-muted-foreground">
                  {invite.state === "used" ? (
                    <>
                      Used by {mask(invite.usedByEmail)}
                      {invite.usedAt && ` on ${date(invite.usedAt)}`}
                      {invite.rewardedAt
                        ? " — credited"
                        : " — credit lands when they pay"}
                    </>
                  ) : invite.state === "unused" ? (
                    <>
                      Created {date(invite.createdAt)} · {daysLeft(invite.expiresAt)}
                    </>
                  ) : invite.state === "revoked" ? (
                    <>Created {date(invite.createdAt)} · revoked, slot returned</>
                  ) : (
                    <>Created {date(invite.createdAt)} · expired, slot returned</>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Only rendered where the browser has a share sheet — phones, mostly. */
function ShareButton({ url }: { url: string }) {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return null;

  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label="Share invite link"
      onClick={() =>
        navigator
          .share({ title: "CineVault", text: "Here's 50% off your first month.", url })
          .catch(() => {
            // Dismissing the share sheet rejects. That is not an error.
          })
      }
    >
      <Share2 />
    </Button>
  );
}

function date(d: Date): string {
  return new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function daysLeft(expiresAt: Date): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));

  if (days <= 0) return "expires today";
  if (days === 1) return "expires tomorrow";
  return `expires in ${days} days`;
}

/** j••••@gmail.com — enough to recognise who you invited, not a contact list on screen. */
function mask(email: string | null): string {
  if (!email) return "someone";

  const [local, domain] = email.split("@");
  if (!domain) return "someone";

  return `${local.slice(0, 1)}${"•".repeat(Math.max(3, Math.min(local.length - 1, 6)))}@${domain}`;
}
