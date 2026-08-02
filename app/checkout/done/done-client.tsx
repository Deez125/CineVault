"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

type State = "checking" | "paid" | "pending" | "failed";

/**
 * The post-payment page.
 *
 * It asks STRIPE whether the subscription really went active. Landing on this URL proves
 * nothing — it is a redirect, and anyone can type it — so nobody is ever told they paid
 * because their browser arrived somewhere.
 *
 * Stripe flips `incomplete` to `active` a moment after the card confirms, so this polls for a
 * few seconds rather than declaring failure on the first look.
 */
export function DoneClient({ subscriptionId }: { subscriptionId: string | null }) {
  const router = useRouter();
  const [state, setState] = useState<State>("checking");

  useEffect(() => {
    if (!subscriptionId) {
      setState("failed");
      return;
    }

    let tries = 0;
    let stopped = false;

    const check = async (): Promise<boolean> => {
      tries += 1;
      try {
        const res = await fetch(
          `/api/checkout/status?subscriptionId=${encodeURIComponent(subscriptionId)}`
        );
        const body = await res.json();

        if (body.status === "active" || body.status === "trialing") {
          setState("paid");
          // The webhook that grants Plex access lands a beat later. The dashboard shows the
          // real state, so send them there rather than asserting anything here.
          setTimeout(() => router.push("/dashboard"), 1500);
          return true;
        }

        if (body.status === "incomplete_expired" || body.status === "canceled") {
          setState("failed");
          return true;
        }
      } catch {
        // A blip should not end the flow.
      }
      return false;
    };

    const run = async () => {
      if (await check()) return;

      const timer = setInterval(async () => {
        if (stopped) return clearInterval(timer);
        if ((await check()) || tries > 10) {
          clearInterval(timer);
          setState((s) => (s === "checking" ? "pending" : s));
        }
      }, 1500);
    };

    run();
    return () => {
      stopped = true;
    };
  }, [subscriptionId, router]);

  return (
    <main className="mx-auto max-w-md px-6 py-24 text-center">
      {state === "checking" && (
        <>
          <LoaderCircle className="mx-auto size-8 animate-spin text-muted-foreground" />
          <p className="mt-5 text-sm text-muted-foreground">Confirming your payment</p>
        </>
      )}

      {state === "paid" && (
        <>
          <CircleCheck className="mx-auto size-10 text-success" />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">You&apos;re in.</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Setting up your account. One moment.
          </p>
        </>
      )}

      {/* Payment taken but Stripe has not flipped the subscription yet. Saying it failed
          would be a lie; saying it worked would be a guess. */}
      {state === "pending" && (
        <>
          <LoaderCircle className="mx-auto size-8 animate-spin text-primary" />
          <h1 className="mt-5 text-xl font-semibold tracking-tight">Still processing</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your payment is going through. This can take a minute, and your access will appear
            on your dashboard as soon as it clears.
          </p>
          <Button size="lg" variant="secondary" className="mt-6" render={<Link href="/dashboard" />}>
            Go to my dashboard
          </Button>
        </>
      )}

      {state === "failed" && (
        <>
          <TriangleAlert className="mx-auto size-9 text-destructive" />
          <h1 className="mt-5 text-xl font-semibold tracking-tight">
            That payment didn&apos;t go through
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Nothing was charged. You can try again with a different card.
          </p>
          <Button size="lg" className="mt-6" render={<Link href="/" />}>
            Back to the plans
          </Button>
        </>
      )}
    </main>
  );
}
