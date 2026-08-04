import { CalendarDays, ShieldCheck } from "lucide-react";

/**
 * What an admin sees instead of billing.
 *
 * Shaped like the real plan card on purpose — same headline, same status pill, same footer
 * row — so the page reads as "your plan, which happens to be this one" rather than as a
 * missing feature. There is deliberately nothing to press: no plan picker, no card on file,
 * no cancel. An admin cannot buy or leave a plan they were never charged for.
 */
export function AdminPlan() {
  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-card">
        <div className="flex items-start justify-between gap-4 p-5">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Current plan
              </span>
              <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success ring-1 ring-inset ring-success/20">
                Active
              </span>
            </div>

            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-semibold">Admin</span>
              <span className="text-sm text-muted-foreground">$0/month</span>
            </div>
          </div>

          <ShieldCheck className="size-6 shrink-0 text-success" />
        </div>

        <div className="flex items-center gap-2 border-t px-5 py-3.5 text-sm">
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground">
            Unlimited streams at a time. Never renews, never expires.
          </span>
        </div>
      </section>

    </div>
  );
}
