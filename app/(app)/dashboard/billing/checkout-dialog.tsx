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
  const [intent, setIntent] = useState<{ clientSecret: string; subscriptionId: string } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    fetch("/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ priceId: tier.priceId }),
    })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Could not start checkout.");
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
            {tier.streams} user{tier.streams === 1 ? "" : "s"} ·{" "}
            {money(tier.amount, tier.currency)}/{tier.interval}
          </DialogTitle>
          <DialogDescription>{tier.blurb}</DialogDescription>
        </DialogHeader>

        {error ? (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : !intent ? (
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
            <PayForm tier={tier} subscriptionId={intent.subscriptionId} />
          </Elements>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PayForm({ tier, subscriptionId }: { tier: Tier; subscriptionId: string }) {
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
          `Subscribe for ${money(tier.amount, tier.currency)}/${tier.interval}`
        ) : (
          <>
            <LoaderCircle className="animate-spin" />
            {state === "paying" ? "Processing" : "Confirming"}
          </>
        )}
      </Button>

      <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <Lock className="size-3" />
        Secured by Stripe. Your card details never reach us.
      </p>
    </form>
  );
}
