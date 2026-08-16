"use client";

import { CircleAlert, CircleCheck, Pause, TicketPercent, Wallet } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { SubscriptionDetail } from "@/lib/analytics/stripe-live";

/**
 * The breakdown popup. One row per subscription in the sliced list.
 *
 * Shows for each row:
 *   - who they are (name + email)
 *   - what plan they're on
 *   - what they're paying (list price)
 *   - deductions (recurring discount, and their credit balance)
 *   - subscription status (active / cancelled / past due / paused)
 *
 * Nothing here fetches — the parent hands a pre-filtered list and this just renders it.
 * Popup title changes with the card so the same dialog is reusable for all eight.
 */

export type CardKey =
  | "mrr"
  | "this-month"
  | "next-month"
  | "at-risk"
  | "active"
  | "cancelling"
  | "past-due"
  | "trialing";

const CARD_LABELS: Record<CardKey, { title: string; description: string }> = {
  mrr: {
    title: "MRR breakdown",
    description: "Every active subscription contributing to this month's recurring revenue.",
  },
  "this-month": {
    title: "This month's bookings",
    description: "Everyone we bill this cycle, cancels-at-period-end included.",
  },
  "next-month": {
    title: "Next month's projection",
    description: "Everyone still on the hook after this cycle's cancellations.",
  },
  "at-risk": {
    title: "At-risk revenue",
    description: "Past-due subscriptions — Stripe is still retrying payment.",
  },
  active: {
    title: "Active subscribers",
    description: "Every subscription in an active state right now.",
  },
  cancelling: {
    title: "Cancelling at period end",
    description: "Access continues until their current period ends, then it stops.",
  },
  "past-due": {
    title: "Past due",
    description: "Payment failed on their last invoice. Stripe is retrying.",
  },
  trialing: {
    title: "In trial",
    description: "On a free trial — Stripe hasn't billed them yet.",
  },
};

export function SubscriptionsDialog({
  card,
  onOpenChange,
  details,
}: {
  card: CardKey | null;
  onOpenChange: (open: boolean) => void;
  details: SubscriptionDetail[];
}) {
  const meta = card ? CARD_LABELS[card] : null;
  const totalMonthly = details.reduce((sum, d) => sum + d.effectiveMonthlyCents, 0);
  const totalCredit = details.reduce((sum, d) => sum + d.creditBalanceCents, 0);

  return (
    <Dialog open={card !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{meta?.title ?? "Details"}</DialogTitle>
          {meta?.description && <DialogDescription>{meta.description}</DialogDescription>}
        </DialogHeader>

        {details.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Nothing in this bucket right now.
          </div>
        ) : (
          <>
            <div className="max-h-[60vh] overflow-y-auto">
              <ul className="divide-y">
                {details.map((d) => (
                  <SubscriptionRow key={d.subId} detail={d} />
                ))}
              </ul>
            </div>

            <div className="mt-2 flex flex-wrap justify-between gap-2 border-t pt-3 text-sm">
              <span className="text-muted-foreground">
                {details.length} subscription{details.length === 1 ? "" : "s"}
              </span>
              <div className="flex gap-4 tabular-nums">
                {totalCredit > 0 && (
                  <span className="text-muted-foreground">
                    Credit outstanding: {formatMoney(totalCredit)}
                  </span>
                )}
                <span className="font-semibold">
                  {formatMoney(totalMonthly)}/mo total
                </span>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SubscriptionRow({ detail: d }: { detail: SubscriptionDetail }) {
  const who = d.displayName ?? d.email ?? d.customerId;
  const subline = d.displayName && d.email ? d.email : null;

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold truncate">{who}</span>
            <StatusPill status={d.status} cancelAtPeriodEnd={d.cancelAtPeriodEnd} />
          </div>
          {subline && <p className="text-xs text-muted-foreground truncate">{subline}</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            {d.planLabel}
            {d.streamLimit > 0 && (
              <>
                <span className="mx-1.5">·</span>
                {d.streamLimit} stream{d.streamLimit === 1 ? "" : "s"}
              </>
            )}
            {d.cancelAtPeriodEnd && d.currentPeriodEnd && (
              <>
                <span className="mx-1.5">·</span>
                ends {d.currentPeriodEnd.toLocaleDateString()}
              </>
            )}
          </p>
        </div>

        <div className="text-right shrink-0">
          <div className="text-sm font-semibold tabular-nums">
            {formatMoney(d.effectiveMonthlyCents)}
            <span className="text-xs font-normal text-muted-foreground">/mo</span>
          </div>
          {(d.discountMonthlyCents > 0 || d.creditBalanceCents > 0) && (
            <div className="mt-0.5 space-y-0.5 text-[11px] text-muted-foreground">
              {d.discountMonthlyCents > 0 && (
                <div className="flex items-center justify-end gap-1">
                  <TicketPercent className="size-3" />
                  <span>
                    {d.discountLabel ?? "Discount"}: −{formatMoney(d.discountMonthlyCents)}/mo
                    <span className="ml-1 text-muted-foreground/70">
                      (was {formatMoney(d.listMonthlyCents)})
                    </span>
                  </span>
                </div>
              )}
              {d.creditBalanceCents > 0 && (
                <div className="flex items-center justify-end gap-1">
                  <Wallet className="size-3" />
                  <span>Credit balance: {formatMoney(d.creditBalanceCents)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function StatusPill({
  status,
  cancelAtPeriodEnd,
}: {
  status: string;
  cancelAtPeriodEnd: boolean;
}) {
  // Cancelling supersedes status for the label — an active sub scheduled to cancel reads
  // as "cancelling" first and "active" second, because the answer to "what's this doing?"
  // is the cancellation.
  const label = cancelAtPeriodEnd ? "Cancelling" : LABELS[status] ?? status;
  const tone = cancelAtPeriodEnd ? "warning" : TONES[status] ?? "default";

  const tones = {
    default: "bg-muted text-muted-foreground ring-border",
    success: "bg-success/10 text-success ring-success/25",
    warning: "bg-warning/10 text-warning ring-warning/25",
    destructive: "bg-destructive/10 text-destructive ring-destructive/25",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ring-1 ring-inset",
        tones[tone]
      )}
    >
      <IconFor tone={tone} />
      {label}
    </span>
  );
}

function IconFor({ tone }: { tone: "default" | "success" | "warning" | "destructive" }) {
  if (tone === "success") return <CircleCheck className="size-3" />;
  if (tone === "warning") return <CircleAlert className="size-3" />;
  if (tone === "destructive") return <CircleAlert className="size-3" />;
  return <Pause className="size-3" />;
}

const LABELS: Record<string, string> = {
  active: "Active",
  past_due: "Past due",
  canceled: "Cancelled",
  trialing: "Trialing",
  incomplete: "Incomplete",
  incomplete_expired: "Expired",
  unpaid: "Unpaid",
  paused: "Paused",
};

const TONES: Record<string, "default" | "success" | "warning" | "destructive"> = {
  active: "success",
  past_due: "warning",
  canceled: "destructive",
  trialing: "default",
  incomplete: "warning",
  incomplete_expired: "destructive",
  unpaid: "destructive",
  paused: "default",
};
