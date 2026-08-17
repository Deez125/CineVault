"use client";

import { useCallback, useEffect, useState } from "react";

import { useRouter } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import {
  ArrowDown,
  ArrowUpDown,
  ArrowUp,
  CalendarDays,
  CreditCard,
  ExternalLink,
  Gift,
  LoaderCircle,
  Lock,
  Receipt,
  RotateCcw,
  TriangleAlert,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PlanPicker } from "@/components/app/plan-picker";
import { stripeAppearance } from "@/lib/stripe/appearance";
import type { Tier } from "@/lib/stripe/tiers";
import type {
  CreditBreakdown,
  ProrationPreview,
  SubscriptionDetail,
} from "@/lib/stripe/subscription";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

const money = (minor: number, currency = "usd") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency ?? "usd").toUpperCase(),
    minimumFractionDigits: Math.abs(minor) % 100 === 0 ? 0 : 2,
  }).format(minor / 100);

const date = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "—";

export function BillingClient({
  initial,
  tiers,
}: {
  initial: SubscriptionDetail;
  tiers: Tier[];
}) {
  const router = useRouter();
  const [sub, setSub] = useState(initial);
  const [changing, setChanging] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [updatingCard, setUpdatingCard] = useState(false);
  const [showingCredit, setShowingCredit] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/subscription");
    if (res.ok) setSub(await res.json());
    router.refresh();
  }, [router]);

  async function act(path: string, body?: unknown) {
    setBusy(true);
    try {
      const res = await fetch(`/api/subscription/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "That didn't work.");
      await refresh();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That didn't work.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  /**
   * Change plan, including the bank-confirmation detour some cards require.
   *
   * Kept separate from `act` because this one has three outcomes rather than two. A card that
   * needs 3-D Secure comes back as `requiresAction`, and at that moment NOTHING has changed:
   * the subscription is still on the old plan and Stripe is holding the new one as a pending
   * update. Only after the holder confirms does the invoice pay and the plan swap, which
   * arrives as a webhook. Reporting "Plan updated" before that would be a lie.
   */
  async function changePlan(priceId: string): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch("/api/subscription/change", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ priceId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "That didn't work.");

      if (data.requiresAction && data.clientSecret) {
        const stripe = await stripePromise;
        if (!stripe) throw new Error("Couldn't reach Stripe. Try again.");

        toast.info("Your bank needs to confirm this payment.");
        const { error } = await stripe.handleNextAction({ clientSecret: data.clientSecret });

        // Declined or dismissed. The old plan is untouched, so there is nothing to undo —
        // which is the entire reason for pending_if_incomplete.
        if (error) throw new Error(error.message ?? "That payment wasn't confirmed.");
      }

      await refresh();
      toast.success("Plan updated.");
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That didn't work.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* ── Plan ───────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border bg-card">
        <div className="flex items-start justify-between gap-4 p-5">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Current plan
              </span>
              <StatusPill status={sub.status} cancelling={sub.cancelAtPeriodEnd} />
            </div>

            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-semibold">
                {sub.streams} stream{sub.streams === 1 ? "" : "s"}
              </span>
              <span className="text-sm text-muted-foreground">
                {money(sub.amount, sub.currency)}/{sub.interval}
              </span>
            </div>
          </div>

          <Button variant="secondary" size="lg" onClick={() => setChanging(true)}>
            Change plan
          </Button>
        </div>

        <div className="flex items-center gap-2 border-t px-5 py-3.5 text-sm">
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
          {sub.cancelAtPeriodEnd ? (
            <span className="text-warning">
              Ends {date(sub.currentPeriodEnd)}. You keep watching until then.
            </span>
          ) : (
            <span className="text-muted-foreground">
              Renews {date(sub.currentPeriodEnd)} for{" "}
              {sub.creditBalance > 0 ? (
                <>
                  {/* Both numbers, not just the discounted one. "Renews for $10" on a $20
                      plan looks like a pricing error unless the full price is next to it. */}
                  <span className="line-through">{money(sub.amount, sub.currency)}</span>{" "}
                  <span className="font-medium text-success">
                    {money(Math.max(0, sub.amount - sub.creditBalance), sub.currency)}
                  </span>
                </>
              ) : (
                money(sub.amount, sub.currency)
              )}
            </span>
          )}
        </div>


        {sub.cancelAtPeriodEnd && (
          <div className="border-t p-5">
            <Button size="lg" disabled={busy} onClick={() => act("resume")}>
              {busy ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}
              Keep my plan
            </Button>
          </div>
        )}

        {sub.status === "past_due" && (
          <div className="border-t p-5">
            <Alert variant="destructive">
              <CreditCard />
              <AlertDescription>
                Your last payment didn&apos;t go through. Update your card to keep access.
              </AlertDescription>
            </Alert>
          </div>
        )}
      </section>

      {/* ── Credit ───────────────────────────────────────────────────────────
          Always on screen, zeroes included. Hiding it until there is money in it means
          nobody discovers credit exists until the day they happen to have some, and
          somebody looking to check whether their referral paid out finds nothing at all
          rather than a clear $0. */}
      <section className="rounded-xl border bg-card">
          <div className="px-5 pt-5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Your credit
          </div>

          {/* Named exactly as the customer would name them. "Referral rewards" and "Refunds
              and plan changes" described where the money came from but did not use the words
              anybody is actually looking for. Every row is always shown, zero or not, because
              the point of this panel is that the two sources are visible and add up. */}
          <div className="mt-3 space-y-1 px-5 text-sm">
            <div className="flex justify-between gap-4">
              <span className="flex items-center gap-2 text-muted-foreground">
                <Gift className="size-3.5 text-success" />
                Referral credit
              </span>
              <span className="tabular-nums">
                {money(sub.credit.fromReferrals, sub.credit.currency)}
              </span>
            </div>

            <div className="flex justify-between gap-4">
              <span className="flex items-center gap-2 text-muted-foreground">
                <User className="size-3.5 text-muted-foreground" />
                Account credit
              </span>
              <span className="tabular-nums">
                {money(sub.credit.fromAdjustments, sub.credit.currency)}
              </span>
            </div>

            {/* Only when some has been spent, so the rows still add up to the total below. */}
            {sub.credit.used > 0 && (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Used on past bills</span>
                <span className="tabular-nums">
                  −{money(sub.credit.used, sub.credit.currency)}
                </span>
              </div>
            )}
          </div>

          <div className="mt-3 flex items-end justify-between gap-4 border-t px-5 py-4">
            <div>
              <div className="font-medium">Total credit</div>
              <div className="text-xs text-muted-foreground">
                {sub.credit.available > 0 ? "ready to use" : "nothing available yet"}
              </div>
            </div>
            <div
              className={`text-3xl font-semibold tabular-nums ${
                sub.credit.available > 0 ? "text-success" : "text-muted-foreground"
              }`}
            >
              {money(sub.credit.available, sub.credit.currency)}
            </div>
          </div>


          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3">
            <p className="text-xs text-muted-foreground">
              Spent automatically — on your next bill, and on any upgrade you make before
              then. There is nothing to redeem.
            </p>
            {sub.credit.history.length > 0 && (
              <button
                type="button"
                onClick={() => setShowingCredit(true)}
                className="shrink-0 text-xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
              >
                See credit history
              </button>
            )}
          </div>
        </section>

      {/* ── Card ───────────────────────────────────────────────────────────── */}
      <section className="flex flex-col items-start gap-3 rounded-xl border bg-card p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Payment method
          </div>
          {sub.paymentMethod ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
              <CreditCard className="size-4 text-muted-foreground" />
              <span>
                <span className="capitalize">{sub.paymentMethod.brand}</span> ending{" "}
                {sub.paymentMethod.last4}
              </span>
              <span className="text-xs text-muted-foreground">
                exp {String(sub.paymentMethod.expMonth).padStart(2, "0")}/
                {String(sub.paymentMethod.expYear).slice(-2)}
              </span>
            </div>
          ) : (
            <div className="mt-2 text-sm text-muted-foreground">No card on file</div>
          )}
        </div>

        <Button variant="secondary" size="lg" onClick={() => setUpdatingCard(true)}>
          Update
        </Button>
      </section>

      {/* ── Invoices ───────────────────────────────────────────────────────── */}
      {sub.invoices.length > 0 && (
        <section className="rounded-xl border bg-card">
          <div className="flex items-center gap-2 border-b px-5 py-3.5 text-sm font-semibold">
            <Receipt className="size-4 text-muted-foreground" />
            Billing history
          </div>
          <div className="max-h-72 overflow-y-auto">
            {sub.invoices.map((invoice) => (
              <div
                key={invoice.id}
                className="flex items-center justify-between border-b px-5 py-3 last:border-0"
              >
                <div>
                  <div className="text-sm">{date(invoice.created)}</div>
                  <div className="text-xs capitalize text-muted-foreground">{invoice.status}</div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm tabular-nums">
                    {money(invoice.amount, invoice.currency)}
                  </span>
                  {invoice.url && (
                    <a
                      href={invoice.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-muted-foreground transition-colors hover:text-foreground"
                      aria-label="View receipt"
                    >
                      <ExternalLink className="size-4" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Keyed on the open flag so each opening is a fresh mount. That is what lets the
          dialogs initialise their state from props instead of resetting it in an effect. */}
      <ChangePlanDialog
        key={`change-${changing}`}
        open={changing}
        onOpenChange={setChanging}
        tiers={tiers}
        sub={sub}
        onChanged={async (priceId) => {
          const ok = await changePlan(priceId);
          if (ok) setChanging(false);
        }}
        onCancel={() => {
          // Close this one before opening the other. Two dialogs open at once fight over
          // focus and the page ends up scroll-locked by whichever unmounts second.
          setChanging(false);
          setCancelling(true);
        }}
        busy={busy}
      />

      <CreditHistoryDialog
        open={showingCredit}
        onOpenChange={setShowingCredit}
        credit={sub.credit}
      />

      <CancelDialog
        open={cancelling}
        onOpenChange={setCancelling}
        endsAt={sub.currentPeriodEnd}
        busy={busy}
        onConfirm={async () => {
          const ok = await act("cancel");
          if (ok) {
            setCancelling(false);
            toast.success("Cancelled. You keep access until the period ends.");
          }
        }}
      />

      <UpdateCardDialog
        key={`card-${updatingCard}`}
        open={updatingCard}
        onOpenChange={setUpdatingCard}
        onSaved={async () => {
          setUpdatingCard(false);
          await refresh();
          toast.success("Card updated.");
        }}
      />
    </div>
  );
}

/**
 * The subscription's real state.
 *
 * Every status is named explicitly and the fallback is the raw string, never "Active". The
 * previous version treated anything that wasn't past_due or cancelling as Active, so an
 * `incomplete` subscription from an abandoned checkout was presented as a live plan, complete
 * with a renewal date. Guessing in the optimistic direction about whether somebody has paid
 * is the wrong way round.
 */
function StatusPill({ status, cancelling }: { status: string; cancelling: boolean }) {
  if (cancelling) return <Pill tone="warning">Cancelling</Pill>;

  switch (status) {
    case "active":
      return <Pill tone="success">Active</Pill>;
    case "trialing":
      return <Pill tone="success">Trial</Pill>;
    case "past_due":
      return <Pill tone="destructive">Payment failed</Pill>;
    case "unpaid":
      return <Pill tone="destructive">Unpaid</Pill>;
    case "incomplete":
    case "incomplete_expired":
      return <Pill tone="warning">Payment not finished</Pill>;
    case "canceled":
      return <Pill tone="destructive">Cancelled</Pill>;
    case "paused":
      return <Pill tone="warning">Paused</Pill>;
    default:
      return <Pill tone="warning">{status}</Pill>;
  }
}

function Pill({
  tone,
  children,
}: {
  tone: "success" | "warning" | "destructive";
  children: React.ReactNode;
}) {
  const tones = {
    success: "bg-success/10 text-success ring-success/25",
    warning: "bg-warning/10 text-warning ring-warning/25",
    destructive: "bg-destructive/10 text-destructive ring-destructive/25",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** Change tier, with the real prorated cost shown before anything is committed. */
function ChangePlanDialog({
  open,
  onOpenChange,
  tiers,
  sub,
  onChanged,
  onCancel,
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tiers: Tier[];
  sub: SubscriptionDetail;
  onChanged: (priceId: string) => void;
  /** Hands off to the cancel dialog. Omitted where cancelling is not on offer. */
  onCancel?: () => void;
  busy: boolean;
}) {
  // Initialised once per mount. The parent remounts this via `key` when the dialog opens, so
  // there is no reset effect: a half-finished change cannot linger, and nothing sets state
  // synchronously inside an effect to undo it.
  const [selected, setSelected] = useState(sub.priceId);

  // The result is tagged with the price it describes. That tag is what makes "still loading"
  // a DERIVED value rather than another piece of state to keep in step — and it also means a
  // slow response for a plan the member already clicked past can never be shown against the
  // one they landed on.
  const [result, setResult] = useState<{
    priceId: string;
    data: ProrationPreview | null;
    error?: string;
  } | null>(null);

  const changed = selected !== sub.priceId;

  // Naming the plan turns "Upgrade" into "Upgrading to 2 Users", so the header says what is
  // happening rather than only that something is. Falls back to a neutral word if the tier
  // list and the selection ever disagree.
  const targetLabel = tiers.find((t) => t.priceId === selected)?.label ?? "your new plan";
  const previewing = changed && result?.priceId !== selected;
  const preview = result?.priceId === selected ? result.data : null;

  useEffect(() => {
    if (!open || !changed) return;

    let cancelled = false;
    const priceId = selected;

    fetch("/api/subscription/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ priceId }),
    })
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (body.error) {
          setResult({ priceId, data: null, error: body.error });
          toast.error(body.error);
          return;
        }
        setResult({ priceId, data: body });
      })
      .catch((err) => {
        if (cancelled) return;
        setResult({ priceId, data: null, error: err.message });
        toast.error(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [open, changed, selected]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Change your plan</DialogTitle>
          <DialogDescription>
            How many people can watch at the same time.
          </DialogDescription>
        </DialogHeader>

        <PlanPicker
          tiers={tiers}
          value={selected}
          current={sub.priceId}
          onChange={setSelected}
          disabled={busy}
        />

        {/* The real number, before they commit. Never let a price be a surprise. */}
        <div className="min-h-[76px]">
          {!changed ? (
            <p className="px-1 text-sm text-muted-foreground">
              This is your current plan.
            </p>
          ) : result?.error && result.priceId === selected ? (
            <p className="px-1 text-sm text-destructive">
              Couldn&apos;t work out the price. Try again.
            </p>
          ) : previewing || !preview ? (
            <p className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              Working out the price
            </p>
          ) : (
            /* Two questions, in the order people ask them: what happens to my money right
             * now, and what happens every month after. Everything settles today, so there is
             * no third question about a future invoice carrying adjustments — which is what
             * made the old panel unreadable once somebody changed plan twice. */
            <div className="rounded-lg border bg-muted/40 p-4 text-sm">
              <div className="flex items-center gap-2 font-medium">
                {preview.upgrading ? (
                  <ArrowUp className="size-4 text-success" />
                ) : (
                  <ArrowDown className="size-4 text-warning" />
                )}
                {preview.upgrading ? "Upgrading" : "Downgrading"} to {targetLabel}
              </div>

              {preview.upgrading ? (
                <>
                  <div className="mt-3 space-y-1 border-t pt-3">
                    <Row
                      label={`${targetLabel} for the rest of this ${sub.interval}`}
                      value={money(preview.prorationAmount, preview.currency)}
                    />
                    {preview.creditApplied > 0 && (
                      <Row
                        label="Account credit"
                        value={`−${money(preview.creditApplied, preview.currency)}`}
                        tone="success"
                      />
                    )}
                  </div>

                  <div className="mt-3 flex items-end justify-between gap-4 border-t pt-3">
                    <div>
                      <div className="font-medium">Charged now</div>
                      <div className="text-xs text-muted-foreground">
                        {preview.dueNow === 0 ? "covered by your credit" : "on your card"}
                      </div>
                    </div>
                    <div className="text-3xl font-semibold tabular-nums">
                      {money(preview.dueNow, preview.currency)}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="mt-3 space-y-1 border-t pt-3">
                    <Row
                      label="Unused time on your current plan"
                      value={`+${money(preview.creditBack, preview.currency)}`}
                      tone="success"
                    />
                  </div>

                  <div className="mt-3 flex items-end justify-between gap-4 border-t pt-3">
                    <div>
                      <div className="font-medium">Credit back</div>
                      <div className="text-xs text-muted-foreground">
                        comes off your next bill
                      </div>
                    </div>
                    <div className="text-3xl font-semibold tabular-nums text-success">
                      {money(preview.creditBack, preview.currency)}
                    </div>
                  </div>
                </>
              )}

              <p className="mt-2.5 border-t pt-2.5 text-xs text-muted-foreground">
                Then {money(preview.nextBillTotal, preview.currency)} on{" "}
                {date(preview.nextBillDate)}
                {preview.nextBillTotal !== preview.nextAmount &&
                  ` (credit applied), ${money(preview.nextAmount, preview.currency)} every ${sub.interval} after`}
                {preview.nextBillTotal === preview.nextAmount &&
                  `, and every ${sub.interval} after`}
                . Your access changes straight away.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          {/* Cancelling lives here because this is where somebody comes when their plan is
              wrong — sometimes the answer is a smaller plan and sometimes it is none at all.
              Kept as plain text rather than a button: it should be findable by anyone
              looking for it and never compete with the action we would rather they take.
              `mr-auto` pushes it left, away from the two real buttons. */}
          {onCancel && !sub.cancelAtPeriodEnd && (
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="py-1 text-xs text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50 sm:mr-auto"
            >
              Cancel my subscription
            </button>
          )}

          <DialogClose
            render={
              <Button variant="secondary" size="lg" disabled={busy}>
                Never mind
              </Button>
            }
          />
          <Button
            size="lg"
            disabled={!changed || busy || previewing}
            onClick={() => onChanged(selected)}
          >
            {busy && <LoaderCircle className="animate-spin" />}
            {preview?.upgrading ? "Upgrade" : "Switch plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({
  open,
  onOpenChange,
  endsAt,
  onConfirm,
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  endsAt: string | null;
  onConfirm: () => void;
  busy: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel your plan?</DialogTitle>
          <DialogDescription>
            You keep watching until the end of the period you&apos;ve already paid for.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border bg-muted/40 p-4 text-sm">
          <p>
            Your access continues until{" "}
            <b>{endsAt ? date(endsAt) : "the end of your period"}</b>. After that your Plex
            access is removed.
          </p>
          <p className="mt-2 text-muted-foreground">
            You won&apos;t be charged again, and you can come back any time.
          </p>
        </div>

        <DialogFooter>
          <DialogClose
            render={
              <Button variant="secondary" size="lg" disabled={busy}>
                Never mind
              </Button>
            }
          />
          <Button variant="destructive" size="lg" disabled={busy} onClick={onConfirm}>
            {busy && <LoaderCircle className="animate-spin" />}
            Cancel my plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UpdateCardDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // No teardown branch: the parent remounts this via `key` when the dialog opens, so it
  // starts empty every time. A stale SetupIntent must never survive into a second attempt.
  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    fetch("/api/subscription/card", { method: "POST" })
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (body.error) throw new Error(body.error);
        setClientSecret(body.clientSecret);
      })
      .catch((err) => !cancelled && setError(err.message));

    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update your card</DialogTitle>
          <DialogDescription>Your next payment will use this card.</DialogDescription>
        </DialogHeader>

        {error ? (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : !clientSecret ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            Loading
          </div>
        ) : (
          <Elements
            stripe={stripePromise}
            options={{ clientSecret, appearance: stripeAppearance() }}
          >
            <CardForm onSaved={onSaved} />
          </Elements>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CardForm({ onSaved }: { onSaved: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) return;

    setBusy(true);
    setError(null);

    // `redirect: "if_required"` so a card swap doesn't bounce them out of the dialog and back
    // in. It only navigates when the bank actually demands 3DS.
    const { error, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
    });

    if (error) {
      setError(error.message ?? "That card didn't work.");
      setBusy(false);
      return;
    }

    // Saved with Stripe. Now point the subscription at it, or the next invoice still charges
    // the old card and they find out through a failed payment email.
    const res = await fetch("/api/subscription/card", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paymentMethodId: setupIntent?.payment_method }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Saved the card, but couldn't attach it. Try again.");
      setBusy(false);
      return;
    }

    onSaved();
  }

  return (
    <form onSubmit={onSubmit}>
      <PaymentElement options={{ layout: "tabs" }} />

      {error && (
        <Alert variant="destructive" className="mt-4">
          <TriangleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" size="lg" className="mt-5 w-full" disabled={!stripe || busy}>
        {busy && <LoaderCircle className="animate-spin" />}
        {busy ? "Saving" : "Save card"}
      </Button>

      <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <Lock className="size-3" />
        Secured by Stripe. Your card never touches our servers.
      </p>
    </form>
  );
}

/** One line of the next-bill breakdown. Labels left, tabular figures right so they align. */
function Row({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "success";
}) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${tone === "success" ? "text-success" : ""}`}>{value}</span>
    </div>
  );
}

/**
 * Every movement of credit, newest first.
 *
 * Behind a dialog rather than on the page: the summary answers "how much have I got", which
 * is what almost everybody wants, and this answers "where did that come from", which is what
 * you want on the one day the number surprises you.
 *
 * Each row carries the balance AFTER it, so the column can be read downward and checked
 * against the total instead of taken on trust.
 */
function CreditHistoryDialog({
  open,
  onOpenChange,
  credit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  credit: CreditBreakdown;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Credit history</DialogTitle>
          <DialogDescription>
            Everything that has been added to or taken from your credit.
          </DialogDescription>
        </DialogHeader>

        <ul className="-mx-1 max-h-[22rem] divide-y overflow-y-auto">
          {credit.history.map((entry) => (
            <li key={entry.id} className="flex items-start gap-3 px-1 py-3">
              <span className="mt-0.5 shrink-0">
                {entry.kind === "referral" ? (
                  <Gift className="size-4 text-success" />
                ) : entry.kind === "plan_change" ? (
                  <ArrowUpDown className="size-4 text-muted-foreground" />
                ) : (
                  <User className="size-4 text-muted-foreground" />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <div className="text-sm">{entry.label}</div>
                <div className="text-xs text-muted-foreground">
                  {date(entry.at)} · {money(entry.balanceAfter, credit.currency)} left
                </div>
              </div>

              <span
                className={`shrink-0 text-sm tabular-nums ${
                  entry.amount > 0 ? "text-success" : "text-muted-foreground"
                }`}
              >
                {entry.amount > 0 ? "+" : "−"}
                {money(Math.abs(entry.amount), credit.currency)}
              </span>
            </li>
          ))}
        </ul>

        <DialogFooter>
          <div className="mr-auto text-sm">
            <span className="text-muted-foreground">Total credit </span>
            <span className="font-medium tabular-nums text-success">
              {money(credit.available, credit.currency)}
            </span>
          </div>
          <DialogClose render={<Button variant="secondary" size="lg">Close</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
