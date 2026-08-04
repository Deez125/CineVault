"use client";

import { useState } from "react";
import { Check, MonitorPlay } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CheckoutDialog } from "./checkout-dialog";
import { cn } from "@/lib/utils";
import type { Tier } from "@/lib/stripe/tiers";

const INCLUDED = ["The full library", "Change or cancel any time", "Card handled by Stripe"];

const money = (minor: number, currency = "usd") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
  }).format(minor / 100);

/**
 * Choosing a first plan.
 *
 * Four columns rather than a cramped two-by-two grid, and the description gets its own line
 * with room to finish its sentence. The previous version put the price beside the blurb in a
 * narrow card, which truncated it mid-word — a plan whose description reads "One thing
 * playing at a t..." is not describing anything.
 */
export function PlanChooser({ tiers, preselect }: { tiers: Tier[]; preselect?: string }) {
  // The cheapest, when they haven't picked one from the marketing page. Defaulting to a
  // dearer plan nudges people into paying more than they meant to, which is a refund and a
  // bad taste rather than extra revenue. tiers is sorted by stream count.
  const fallback = tiers[0]?.priceId ?? "";
  const wanted = tiers.some((t) => t.priceId === preselect) ? preselect! : fallback;

  const [selected, setSelected] = useState(wanted);
  const [paying, setPaying] = useState(false);

  const tier = tiers.find((t) => t.priceId === selected);

  if (tiers.length === 0) {
    return (
      <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
        Plans are unavailable right now. Please try again in a moment.
      </p>
    );
  }

  return (
    <>
      <div className="rounded-xl border bg-card p-6">
        <h2 className="text-base font-semibold">How many streams at once?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          How many things can play at the same time. Not how many Plex accounts — one account,
          this many simultaneous streams. Change it whenever you like; the difference is
          prorated.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {tiers.map((t) => {
            const active = t.priceId === selected;

            return (
              <button
                key={t.priceId}
                type="button"
                onClick={() => setSelected(t.priceId)}
                aria-pressed={active}
                className={cn(
                  "group relative flex flex-col rounded-lg border p-4 text-left transition-all",
                  active
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "hover:border-foreground/25 hover:bg-muted/40"
                )}
              >
                <span
                  className={cn(
                    "absolute right-3 top-3 flex size-4 items-center justify-center rounded-full border transition-colors",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border group-hover:border-foreground/40"
                  )}
                >
                  {active && <Check className="size-2.5" />}
                </span>

                <span className="flex items-center gap-1.5 pr-6 text-sm font-medium">
                  <MonitorPlay
                    className={cn(
                      "size-4 shrink-0",
                      active ? "text-primary" : "text-muted-foreground"
                    )}
                  />
                  {t.streams} stream{t.streams === 1 ? "" : "s"}
                </span>

                <span className="mt-3 flex items-baseline gap-1">
                  <span className="text-2xl font-semibold tabular-nums">
                    {money(t.amount, t.currency)}
                  </span>
                  <span className="text-xs text-muted-foreground">/{t.interval}</span>
                </span>

                {/* The same three lines on every card, under the price.
                    They are identical across tiers on purpose — the point is that the ONLY
                    difference between plans is the stream count, and a column of matching
                    ticks says that faster than a sentence would. The per-tier descriptions
                    used to sit here, and being different lengths they made the four cards
                    different heights, which read as though the plans differed in more than
                    the number. */}
                <span className="mt-4 space-y-1.5 border-t pt-3">
                  {INCLUDED.map((line) => (
                    <span key={line} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Check className="size-3 shrink-0 text-success" />
                      {line}
                    </span>
                  ))}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t pt-5">
          <div className="text-sm">
            {tier ? (
              <>
                <span className="text-muted-foreground">You&apos;ll pay </span>
                <span className="font-semibold">
                  {money(tier.amount, tier.currency)}
                </span>
                <span className="text-muted-foreground">
                  {" "}
                  a {tier.interval}, cancel any time.
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">Pick a plan to continue.</span>
            )}
          </div>

          <Button size="lg" disabled={!tier} onClick={() => setPaying(true)}>
            Continue to payment
          </Button>
        </div>
      </div>


      {tier && (
        <CheckoutDialog
          key={`checkout-${paying}-${tier.priceId}`}
          open={paying}
          onOpenChange={setPaying}
          tier={tier}
        />
      )}
    </>
  );
}
