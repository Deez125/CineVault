"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Tier } from "@/lib/stripe/tiers";

const money = (minor: number, currency = "usd") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
  }).format(minor / 100);

/**
 * Choose a tier.
 *
 * Discrete cards rather than a slider. A slider implies a continuous range and fires on every
 * pixel of a drag, which for a control wired to real money means either debouncing carefully
 * or asking Stripe to price a plan the member passed through on the way to another one. Four
 * options, four buttons.
 */
export function PlanPicker({
  tiers,
  value,
  current,
  onChange,
  disabled,
}: {
  tiers: Tier[];
  value: string;
  /** The price they are on now, marked so the change is always relative to something. */
  current?: string;
  onChange: (priceId: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {tiers.map((tier) => {
        const selected = tier.priceId === value;
        const isCurrent = tier.priceId === current;

        return (
          <button
            key={tier.priceId}
            type="button"
            disabled={disabled}
            onClick={() => onChange(tier.priceId)}
            aria-pressed={selected}
            className={cn(
              "relative flex items-center justify-between gap-3 rounded-lg border p-3.5 text-left transition-colors",
              "disabled:cursor-not-allowed disabled:opacity-60",
              selected
                ? "border-primary bg-primary/5"
                : "hover:border-foreground/25 hover:bg-muted/50"
            )}
          >
            {/* Name only. The descriptions were longer than the card and truncated to
                "For a household ..." on every one of them, which is not a description — it
                is clutter that pushed the name into wrapping. The plan names already say
                what the plans are. */}
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{tier.label}</div>
              {isCurrent && (
                <div className="truncate text-xs text-muted-foreground">Current</div>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2.5">
              <span className="text-sm font-semibold tabular-nums">
                {money(tier.amount, tier.currency)}
                <span className="text-xs font-normal text-muted-foreground">
                  /{tier.interval}
                </span>
              </span>
              <span
                className={cn(
                  "flex size-4 items-center justify-center rounded-full border",
                  selected ? "border-primary bg-primary text-primary-foreground" : "border-border"
                )}
              >
                {selected && <Check className="size-2.5" />}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
