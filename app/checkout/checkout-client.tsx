"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { ArrowLeft, Check, LoaderCircle, Lock, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { stripeAppearance } from "@/lib/stripe/appearance";
import type { Tier } from "@/lib/stripe/tiers";

/**
 * Checkout.
 *
 * Nothing on this page grants access. The subscription behind it was created as
 * `incomplete`, so it entitles nothing until Stripe confirms the card, and access is granted
 * afterwards by the webhook. An abandoned checkout costs nothing and cleans itself up.
 */

// Loaded once, at module scope. Calling loadStripe on every render re-fetches Stripe's script
// and thrashes the iframe.
const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

const money = (minor: number, currency = "usd") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
  }).format(minor / 100);

type Intent = { clientSecret: string; subscriptionId: string };

export function CheckoutClient({ tier }: { tier: Tier }) {
  const [intent, setIntent] = useState<Intent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
  }, [tier.priceId]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to plans
      </Link>

      {error && (
        <Alert variant="destructive" className="mt-6">
          <TriangleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        <div className="rounded-xl border bg-card p-6">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            You&apos;re subscribing to
          </div>

          <div className="mt-1.5 flex items-baseline justify-between gap-4">
            <span className="text-2xl font-semibold">{tier.label}</span>
            <span className="text-2xl font-semibold tabular-nums">
              {money(tier.amount, tier.currency)}
              <span className="text-sm font-normal text-muted-foreground">/{tier.interval}</span>
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{tier.blurb}</p>

          <div className="my-6 h-px bg-border" />

          <ul className="space-y-2.5 text-sm">
            {[
              `${tier.streams} user${tier.streams === 1 ? "" : "s"} at a time`,
              "The full library",
              "Change or cancel any time",
            ].map((feature) => (
              <li key={feature} className="flex items-center gap-2">
                <Check className="size-4 shrink-0 text-success" />
                {feature}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border bg-card p-6">
          {intent ? (
            <PaymentPane intent={intent} tier={tier} />
          ) : (
            !error && (
              <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                Preparing checkout
              </div>
            )
          )}
        </div>
      </div>
    </main>
  );
}

function PaymentPane({ intent, tier }: { intent: Intent; tier: Tier }) {
  // Read the theme tokens once, in the browser, after styles have loaded.
  const appearance = useMemo(() => stripeAppearance(), []);

  return (
    <Elements
      // Keyed on the secret: a new intent means a new Elements instance, because Stripe will
      // not let you swap the client secret on a mounted one.
      key={intent.clientSecret}
      stripe={stripePromise}
      options={{ clientSecret: intent.clientSecret, appearance }}
    >
      <PaymentForm tier={tier} subscriptionId={intent.subscriptionId} />
    </Elements>
  );
}

function PaymentForm({ tier, subscriptionId }: { tier: Tier; subscriptionId: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    setError(null);

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/checkout/done?subscription_id=${subscriptionId}`,
      },
    });

    // Only reached when confirmation FAILED: on success Stripe navigates away, so there is no
    // success branch to write here. A declined card is the customer's problem to fix, not an
    // exception to throw.
    setError(error?.message ?? "Something went wrong. Try again.");
    setSubmitting(false);
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

      <Button type="submit" size="lg" className="mt-6 w-full" disabled={!stripe || submitting}>
        {submitting ? (
          <>
            <LoaderCircle className="animate-spin" />
            Processing
          </>
        ) : (
          `Subscribe for ${money(tier.amount, tier.currency)}/${tier.interval}`
        )}
      </Button>

      <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <Lock className="size-3" />
        Secured by Stripe. Your card details never reach us.
      </p>
    </form>
  );
}
