"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlanPicker } from "@/components/app/plan-picker";
import { Button } from "@/components/ui/button";
import type { Tier } from "@/lib/stripe/tiers";

/**
 * Shown to somebody with no subscription.
 *
 * Deliberately does NOT create anything itself. It sends them to /checkout, which is the one
 * place a subscription is ever created, so there is a single path to becoming a paying member
 * rather than two that have to stay in step.
 */
export function PlanChooser({ tiers }: { tiers: Tier[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState(tiers[1]?.priceId ?? tiers[0]?.priceId ?? "");
  const [going, setGoing] = useState(false);

  if (tiers.length === 0) {
    return (
      <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
        Plans are unavailable right now. Please try again in a moment.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-medium">How many people will be watching?</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          You can change this at any time, and the difference is prorated.
        </p>

        <div className="mt-4">
          <PlanPicker tiers={tiers} value={selected} onChange={setSelected} disabled={going} />
        </div>

        <Button
          size="lg"
          className="mt-5 w-full sm:w-auto"
          disabled={going || !selected}
          onClick={() => {
            setGoing(true);
            router.push(`/checkout?price=${encodeURIComponent(selected)}`);
          }}
        >
          Continue to payment
        </Button>
      </div>
    </div>
  );
}
