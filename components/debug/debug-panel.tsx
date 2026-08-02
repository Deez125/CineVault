"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bug,
  CircleCheck,
  CircleX,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The debug panel.
 *
 * Floats above the site rather than living on a page, so you can watch state change while
 * using the thing you are debugging. Everything it shows about Stripe is read LIVE from
 * Stripe, not from our columns: the reason to open this is usually that you suspect the cache
 * is wrong, and a panel that renders the cache back at you would agree with the bug.
 *
 * Visibility is decided on the server (see lib/debug.ts). Hiding the button would only be
 * presentation; every endpoint behind it checks for itself.
 */

type DebugState = {
  db: Record<string, unknown>;
  stripe: {
    subscriptions: { id: string; status: string; amount: number; cancelAtPeriodEnd: boolean }[];
    error: string | null;
  };
  integrations: { plex: boolean; tracearr: boolean; webhook: boolean };
};

export function DebugPanel() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<DebugState | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/debug/state");
      if (res.ok) setState(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  // Opening is an EVENT, so the fetch belongs in the click handler rather than an effect
  // watching `open`. Same result, no synchronous setState inside an effect, and no cascading
  // render on every toggle.
  const openPanel = useCallback(() => {
    setOpen(true);
    void load();
  }, [load]);

  async function terminate() {
    setWorking(true);
    try {
      const res = await fetch("/api/debug/terminate", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed.");

      const count = body.terminated?.length ?? 0;
      toast.success(
        count === 0
          ? "Nothing was live to terminate."
          : `Terminated ${count} subscription${count === 1 ? "" : "s"}.`
      );

      setConfirming(false);
      await load();
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setWorking(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={openPanel}
        title="Debug panel"
        aria-label="Open debug panel"
        className="fixed bottom-4 right-4 z-50 flex size-10 items-center justify-center rounded-full border bg-card shadow-lg transition-colors hover:bg-muted"
      >
        <Bug className="size-4 text-muted-foreground" />
      </button>
    );
  }

  return (
    // z-50 and fixed: above the app, including the sidebar and any open dialog backdrop.
    <div className="fixed bottom-4 right-4 z-50 flex max-h-[80vh] w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border bg-card shadow-2xl">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Bug className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Debug</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={load}
            disabled={loading}
            aria-label="Refresh"
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setOpen(false)}
            aria-label="Close debug panel"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm">
        {!state ? (
          <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            Loading
          </div>
        ) : (
          <div className="space-y-5">
            <Group title="Integrations">
              <Flag label="Plex" ok={state.integrations.plex} />
              <Flag label="Tracearr" ok={state.integrations.tracearr} />
              <Flag label="Stripe webhook" ok={state.integrations.webhook} />
            </Group>

            <Group title="Database">
              {Object.entries(state.db).map(([key, value]) => (
                <Row key={key} label={key} value={value} />
              ))}
            </Group>

            <Group title="Stripe (live)">
              {state.stripe.error ? (
                <p className="text-destructive">{state.stripe.error}</p>
              ) : state.stripe.subscriptions.length === 0 ? (
                <p className="text-muted-foreground">No subscriptions.</p>
              ) : (
                state.stripe.subscriptions.map((s) => (
                  <div key={s.id} className="rounded-md border bg-muted/40 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          "font-medium",
                          ["active", "trialing"].includes(s.status)
                            ? "text-success"
                            : s.status === "past_due"
                              ? "text-warning"
                              : "text-muted-foreground"
                        )}
                      >
                        {s.status}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        ${(s.amount / 100).toFixed(2)}
                      </span>
                    </div>
                    <div className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">
                      {s.id}
                    </div>
                    {s.cancelAtPeriodEnd && (
                      <div className="mt-0.5 text-xs text-warning">cancels at period end</div>
                    )}
                  </div>
                ))
              )}
            </Group>

            <Group title="Danger">
              {confirming ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                  <p className="flex items-start gap-2 text-xs">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                    <span>
                      Cancels every subscription on this account in Stripe immediately, with no
                      remaining paid period, and removes access. Not a refund.
                    </span>
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="flex-1"
                      disabled={working}
                      onClick={() => setConfirming(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="flex-1"
                      disabled={working}
                      onClick={terminate}
                    >
                      {working && <LoaderCircle className="animate-spin" />}
                      Terminate
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="destructive"
                  size="sm"
                  className="w-full"
                  onClick={() => setConfirming(true)}
                >
                  Terminate subscription now
                </Button>
              )}
            </Group>
          </div>
        )}
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function Flag({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("flex items-center gap-1", ok ? "text-success" : "text-muted-foreground")}>
        {ok ? <CircleCheck className="size-3.5" /> : <CircleX className="size-3.5" />}
        {ok ? "configured" : "not set"}
      </span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: unknown }) {
  const display =
    value === null || value === undefined
      ? "null"
      : typeof value === "boolean"
        ? String(value)
        : String(value);

  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span
        className={cn(
          "break-all text-right font-mono",
          value === null || value === undefined || value === false
            ? "text-muted-foreground"
            : value === true
              ? "text-success"
              : ""
        )}
      >
        {display}
      </span>
    </div>
  );
}
