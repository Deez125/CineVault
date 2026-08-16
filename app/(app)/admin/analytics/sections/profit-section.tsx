import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * Profit is MRR minus the active costs the admin has entered — nothing more.
 *
 * "Now" profit uses current MRR. "Next month" projection uses next-month MRR (which
 * already accounts for cancels-at-period-end from stripe-live), so the drop from this
 * month to next shows through both revenue and profit lines.
 *
 * Margin is displayed alongside so a shrinking absolute-dollar profit doesn't look scary
 * on its own — the same profit at a smaller revenue is a bigger margin, and the reverse
 * is worth flagging.
 */
export function ProfitSection({
  mrrCents,
  nextMonthCents,
  monthlyCostCents,
}: {
  mrrCents: number;
  nextMonthCents: number;
  monthlyCostCents: number;
}) {
  const profitNow = mrrCents - monthlyCostCents;
  const profitNext = nextMonthCents - monthlyCostCents;
  const marginNow = mrrCents > 0 ? (profitNow / mrrCents) * 100 : 0;
  const marginNext = nextMonthCents > 0 ? (profitNext / nextMonthCents) * 100 : 0;

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="border-b px-5 py-3.5">
        <h2 className="text-sm font-semibold">Profit</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Revenue minus the active fixed costs below. Yearly costs get divided into monthly
          before typing, so both sides are directly comparable.
        </p>
      </div>

      <div className="grid gap-px bg-border sm:grid-cols-2">
        <ProfitCard
          label="This month"
          revenueCents={mrrCents}
          costCents={monthlyCostCents}
          profitCents={profitNow}
          marginPct={marginNow}
        />
        <ProfitCard
          label="Next month"
          revenueCents={nextMonthCents}
          costCents={monthlyCostCents}
          profitCents={profitNext}
          marginPct={marginNext}
          delta={profitNext - profitNow}
        />
      </div>
    </section>
  );
}

function ProfitCard({
  label,
  revenueCents,
  costCents,
  profitCents,
  marginPct,
  delta,
}: {
  label: string;
  revenueCents: number;
  costCents: number;
  profitCents: number;
  marginPct: number;
  delta?: number;
}) {
  const isPositive = profitCents >= 0;

  return (
    <div className="bg-card p-5">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>

      <div
        className={cn(
          "mt-1.5 text-2xl font-semibold tabular-nums",
          isPositive ? "text-success" : "text-destructive"
        )}
      >
        {formatMoney(profitCents)}
      </div>

      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
        <span>
          {formatMoney(revenueCents)} <span className="text-muted-foreground/60">−</span>{" "}
          {formatMoney(costCents)}
        </span>
        <span>·</span>
        <span>{marginPct.toFixed(1)}% margin</span>
        {typeof delta === "number" && delta !== 0 && (
          <>
            <span>·</span>
            <span className={delta < 0 ? "text-warning" : "text-success"}>
              {delta < 0 ? "−" : "+"}
              {formatMoney(Math.abs(delta))} vs. this month
            </span>
          </>
        )}
      </div>
    </div>
  );
}
