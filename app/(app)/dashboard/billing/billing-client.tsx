"use client";

import { useCallback, useEffect, useState } from "react";

import { useRouter } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import {
  ArrowDown,
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
import type { ProrationPreview, SubscriptionDetail } from "@/lib/stripe/subscription";

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
                {sub.streams} user{sub.streams === 1 ? "" : "s"}
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

        {sub.creditBalance > 0 && (
          <div className="flex items-center gap-2 border-t px-5 py-3.5 text-sm">
            <Gift className="size-4 shrink-0 text-success" />
            <span>
              <span className="font-medium text-success">
                {money(sub.creditBalance, sub.currency)} credit
              </span>
              <span className="text-muted-foreground">
                {" "}
                on your account
                {sub.creditBalance > sub.amount
                  ? " — covers your next bill, and the rest rolls over."
                  : " — comes off your next bill automatically."}
              </span>
            </span>
          </div>
        )}

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

      {/* ── Card ───────────────────────────────────────────────────────────── */}
      <section className="flex items-center justify-between gap-4 rounded-xl border bg-card p-5">
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

      {!sub.cancelAtPeriodEnd && (
        <button
          onClick={() => setCancelling(true)}
          className="w-full border-t pt-5 text-center text-xs text-muted-foreground transition-colors hover:text-destructive"
        >
          Cancel my subscription
        </button>
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
          const ok = await act("change", { priceId });
          if (ok) {
            setChanging(false);
            toast.success("Plan updated.");
          }
        }}
        busy={busy}
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
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tiers: Tier[];
  sub: SubscriptionDetail;
  onChanged: (priceId: string) => void;
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
            <div className="rounded-lg border bg-muted/40 p-4 text-sm">
              <div className="flex items-center gap-2 font-medium">
                {preview.upgrading ? (
                  <ArrowUp className="size-4 text-success" />
                ) : (
                  <ArrowDown className="size-4 text-warning" />
                )}
                {preview.upgrading ? "Upgrade" : "Downgrade"}
              </div>

              <div className="mt-2.5 space-y-1 text-muted-foreground">
                <div className="flex justify-between gap-4">
                  <span>
                    {preview.prorationAmount >= 0
                      ? "Added to your next bill"
                      : "Credited to your next bill"}
                  </span>
                  <span
                    className={`tabular-nums ${preview.prorationAmount < 0 ? "text-success" : "text-foreground"}`}
                  >
                    {money(Math.abs(preview.prorationAmount), preview.currency)}
                  </span>
                </div>
                {/* Only when there is one. A "Account credit $0" row on every upgrade is
                    noise, and it makes the real thing easy to miss when it does appear. */}
                {preview.creditApplied > 0 && (
                  <div className="flex justify-between gap-4">
                    <span>Account credit</span>
                    <span className="tabular-nums text-success">
                      −{money(preview.creditApplied, preview.currency)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <span>Next bill on {date(preview.nextBillDate)}</span>
                  <span className="tabular-nums text-foreground">
                    {money(preview.nextBillTotal, preview.currency)}
                  </span>
                </div>
                <div className="flex justify-between gap-4 border-t pt-1">
                  <span>Then every {sub.interval}</span>
                  <span className="tabular-nums text-foreground">
                    {money(preview.nextAmount, preview.currency)}
                  </span>
                </div>
              </div>

              <p className="mt-3 text-xs text-muted-foreground">
                Nothing is charged today. Your access changes straight away.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
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
