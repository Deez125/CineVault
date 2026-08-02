"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * The landing spot after a 3DS challenge.
 *
 * Asks Stripe whether the subscription really went active. Arriving at this URL proves
 * nothing — it is a redirect, and anyone can type it — so nobody is told they have a plan
 * because their browser ended up somewhere.
 */
export function FinishingCheckout({ subscriptionId }: { subscriptionId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"checking" | "slow" | "failed">("checking");

  useEffect(() => {
    let stopped = false;
    let attempts = 0;

    const tick = async () => {
      attempts += 1;
      try {
        const res = await fetch(
          `/api/checkout/status?subscriptionId=${encodeURIComponent(subscriptionId)}`
        );
        const body = await res.json();

        if (body.status === "active" || body.status === "trialing") {
          router.replace("/dashboard/billing");
          router.refresh();
          return true;
        }

        if (body.status === "incomplete_expired" || body.status === "canceled") {
          setState("failed");
          return true;
        }
      } catch {
        // Keep trying.
      }
      return false;
    };

    const loop = setInterval(async () => {
      if (stopped) return clearInterval(loop);
      if ((await tick()) || attempts > 15) {
        clearInterval(loop);
        setState((s) => (s === "checking" ? "slow" : s));
      }
    }, 1500);

    return () => {
      stopped = true;
      clearInterval(loop);
    };
  }, [subscriptionId, router]);

  if (state === "failed") {
    return (
      <div className="rounded-xl border bg-card p-8 text-center">
        <TriangleAlert className="mx-auto size-9 text-destructive" />
        <h2 className="mt-4 text-lg font-semibold">That payment didn&apos;t go through</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Nothing was charged. You can try again with a different card.
        </p>
        <Button
          size="lg"
          className="mt-5"
          onClick={() => router.replace("/dashboard/billing")}
        >
          Choose a plan
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-10 text-center">
      <LoaderCircle className="mx-auto size-8 animate-spin text-muted-foreground" />
      <h2 className="mt-4 text-lg font-semibold">
        {state === "slow" ? "Still processing" : "Confirming your payment"}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {state === "slow"
          ? "Your payment is going through. This can take a minute, and your plan will appear here as soon as it clears."
          : "One moment."}
      </p>

      {state === "slow" && (
        <Alert className="mt-5 text-left">
          <AlertDescription>
            You can safely leave this page. Nothing is lost.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
