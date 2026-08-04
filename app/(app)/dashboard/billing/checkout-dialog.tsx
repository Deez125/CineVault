"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { CircleCheck, LoaderCircle, Lock, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { stripeAppearance } from "@/lib/stripe/appearance";
import type { Tier } from "@/lib/stripe/tiers";
import type { CheckoutIntent, CheckoutQuote } from "@/lib/stripe/checkout";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

const money = (minor: number, currency = "usd") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
  }).format(minor / 100);

/**
 * Paying, without leaving the billing page.
 *
 * Nothing here grants access. The subscription behind it is created `incomplete`, so it
 * entitles nothing until Stripe confirms the card, and access is granted afterwards by the
 * webhook. Closing this dialog halfway costs nothing, and the abandoned attempt is cancelled
 * the next time a checkout starts.
 */
export function CheckoutDialog({
  open,
  onOpenChange,
  tier,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tier: Tier;
}) {
  const [intent, setIntent] = useState<CheckoutIntent | null>(null);
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    // Quote BEFORE creating anything.
    //
    // When credit covers the whole first month there is nothing to charge, and Stripe makes
    // such a subscription live the moment it is created. Creating one just because somebody
    // opened this dialog would subscribe them — and spend their credit — before they pressed
    // a thing. So: ask what it costs, and only create a subscription when a card is needed.
    fetch("/api/checkout/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ priceId: tier.priceId }),
    })
      .then(async (res) => {
        const q = await res.json();
        if (!res.ok) throw new Error(q.error ?? "Could not work out the price.");
        if (cancelled) return;

        setQuote(q);
        if (q.dueNow === 0) return; // nothing to collect; wait for them to confirm

        const res2 = await fetch("/api/checkout", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ priceId: tier.priceId }),
        });
        const body = await res2.json();
        if (!res2.ok) throw new Error(body.error ?? "Could not start checkout.");
        if (!body.clientSecret) throw new Error("Checkout came back empty.");
        if (!cancelled) setIntent(body);
      })
      .catch((err) => !cancelled && setError(err.message));

    return () => {
      cancelled = true;
    };
  }, [open, tier.priceId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {tier.streams} stream{tier.streams === 1 ? "" : "s"} ·{" "}
            {money(tier.amount, tier.currency)}/{tier.interval}
          </DialogTitle>
          <DialogDescription>{tier.blurb}</DialogDescription>
        </DialogHeader>

        {error ? (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : quote && quote.dueNow === 0 ? (
          <FreeStart tier={tier} quote={quote} />
        ) : !intent?.clientSecret ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            Preparing checkout
          </div>
        ) : (
          <Elements
            key={intent.clientSecret}
            stripe={stripePromise}
            options={{ clientSecret: intent.clientSecret, appearance: stripeAppearance() }}
          >
            <PayForm tier={tier} intent={intent} />
          </Elements>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PayForm({ tier, intent }: { tier: Tier; intent: CheckoutIntent }) {
  const { subscriptionId } = intent;

  // Anything that makes today's charge differ from the sticker price: a referral coupon,
  // account credit, or both. Compared against the plan price rather than checked flag by
  // flag, so a future discount we have not thought of still shows up honestly.
  const discounted = intent.dueNow !== intent.recurring;

  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [state, setState] = useState<"idle" | "paying" | "confirming" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) return;

    setState("paying");
    setError(null);

    // `redirect: "if_required"` keeps the whole thing inside the dialog. Stripe only navigates
    // away when the bank actually demands 3DS, and the return_url below is where it comes
    // back to — the billing page, which finishes the job.
    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/dashboard/billing?checkout=${subscriptionId}`,
      },
      redirect: "if_required",
    });

    if (confirmError) {
      // A declined card is the customer's problem to fix, not an exception.
      setError(confirmError.message ?? "That card didn't work. Try another.");
      setState("idle");
      return;
    }

    // Card confirmed. Now ask STRIPE whether the subscription actually went active — the
    // confirmation resolving is not the same thing, and we never tell somebody they are a
    // member because a promise resolved.
    setState("confirming");

    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        const res = await fetch(
          `/api/checkout/status?subscriptionId=${encodeURIComponent(subscriptionId)}`
        );
        const body = await res.json();

        if (body.status === "active" || body.status === "trialing") {
          setState("done");
          // The webhook that provisions Plex lands a beat later. Refreshing shows whatever is
          // actually true by then, rather than asserting anything here.
          setTimeout(() => router.refresh(), 1200);
          return;
        }

        if (body.status === "incomplete_expired" || body.status === "canceled") {
          setError("That payment didn't go through. Nothing was charged.");
          setState("idle");
          return;
        }
      } catch {
        // Keep trying.
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }

    // Paid, but Stripe hasn't flipped it yet. Saying it failed would be a lie and saying it
    // worked would be a guess.
    setState("done");
    setTimeout(() => router.refresh(), 800);
  }

  if (state === "done") {
    return (
      <div className="py-10 text-center">
        <CircleCheck className="mx-auto size-10 text-success" />
        <p className="mt-4 font-medium">You&apos;re in.</p>
        <p className="mt-1 text-sm text-muted-foreground">Setting up your access.</p>
      </div>
    );
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

      <Button
        type="submit"
        size="lg"
        className="mt-5 w-full"
        disabled={!stripe || state !== "idle"}
      >
        {state === "idle" ? (
          discounted ? (
            <span className="flex items-center gap-1.5">
              Subscribe for
              {/* Both numbers. The struck-through price is what makes the smaller one read as
                  a discount rather than as the wrong price. */}
              <span className="line-through opacity-60">
                {money(intent.recurring, intent.currency)}
              </span>
              <span>{money(intent.dueNow, intent.currency)}</span>
            </span>
          ) : (
            `Subscribe for ${money(intent.recurring, intent.currency)}/${tier.interval}`
          )
        ) : (
          <>
            <LoaderCircle className="animate-spin" />
            {state === "paying" ? "Processing" : "Confirming"}
          </>
        )}
      </Button>

      {/* Only when today differs from every month after. Saying "then $20/month" under a
          button that already reads "$20/month" is noise. */}
      {discounted && state === "idle" && (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Then {money(intent.recurring, intent.currency)} per {tier.interval}
          {intent.discount > 0 && intent.creditApplied > 0
            ? ` · ${money(intent.discount, intent.currency)} referral discount and ${money(intent.creditApplied, intent.currency)} credit applied`
            : intent.discount > 0
              ? ` · ${money(intent.discount, intent.currency)} referral discount applied`
              : intent.creditApplied > 0
                ? ` · ${money(intent.creditApplied, intent.currency)} credit applied`
                : ""}
        </p>
      )}

      <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <Lock className="size-3" />
        Secured by Stripe. Your card details never reach us.
      </p>
    </form>
  );
}

/**
 * Starting a plan that costs nothing today, because credit covers it.
 *
 * No Payment Element, because there is no payment. The subscription is created when they
 * press the button and not before — which is the whole point of quoting first. A card can
 * still be added later from the billing page, and Stripe will ask for one when the credit
 * runs out and a real invoice comes due.
 */
function FreeStart({ tier, quote }: { tier: Tier; quote: CheckoutQuote }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "starting" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setState("starting");
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ priceId: tier.priceId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not start your plan.");

      setState("done");
      setTimeout(() => router.refresh(), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start your plan.");
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <div className="py-10 text-center">
        <CircleCheck className="mx-auto size-10 text-success" />
        <p className="mt-4 font-medium">You&apos;re in.</p>
        <p className="mt-1 text-sm text-muted-foreground">Setting up your access.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="rounded-lg border bg-muted/40 p-4 text-sm">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">
            {tier.streams} stream{tier.streams === 1 ? "" : "s"}, one {tier.interval}
          </span>
          <span className="tabular-nums">{money(quote.recurring, quote.currency)}</span>
        </div>

        {quote.discount > 0 && (
          <div className="mt-1 flex justify-between gap-4">
            <span className="text-muted-foreground">Referral discount</span>
            <span className="tabular-nums text-success">
              −{money(quote.discount, quote.currency)}
            </span>
          </div>
        )}

        {quote.creditApplied > 0 && (
          <div className="mt-1 flex justify-between gap-4">
            <span className="text-muted-foreground">Account credit</span>
            <span className="tabular-nums text-success">
              −{money(quote.creditApplied, quote.currency)}
            </span>
          </div>
        )}

        <div className="mt-2 flex items-end justify-between gap-4 border-t pt-2">
          <span className="font-medium">Due today</span>
          <span className="text-2xl font-semibold tabular-nums text-success">
            {money(0, quote.currency)}
          </span>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="mt-4">
          <TriangleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button
        size="lg"
        className="mt-5 w-full"
        disabled={state !== "idle"}
        onClick={start}
      >
        {state === "starting" ? (
          <>
            <LoaderCircle className="animate-spin" />
            Starting
          </>
        ) : (
          "Start my plan"
        )}
      </Button>

      <p className="mt-2 text-center text-xs text-muted-foreground">
        Your credit covers this {tier.interval}. Then{" "}
        {money(quote.recurring, quote.currency)} per {tier.interval} — you can add a card any
        time before then.
      </p>
    </div>
  );
}
