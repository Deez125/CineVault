"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CircleCheck,
  CircleX,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PlexCheck = {
  configured: boolean;
  error?: string;
  owner?: { username: string; email: string };
  libraries?: { shared: string[]; excluded: string[] };
  configuredValues?: string[];
  resolvedIds?: string[];
  shares?: { name: string; protected: boolean }[];
  protectedUsers?: string[];
};

export function ServiceSettingsClient({ protectedCount }: { protectedCount: number }) {
  const router = useRouter();
  const [reconciling, setReconciling] = useState(false);
  const [check, setCheck] = useState<PlexCheck | null>(null);
  const [checking, setChecking] = useState(false);

  const runCheck = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/admin/plex-check");
      if (res.ok) setCheck(await res.json());
      else toast.error("Couldn't reach Plex.");
    } catch {
      toast.error("Couldn't reach Plex.");
    } finally {
      setChecking(false);
    }
  }, []);

  async function reconcile() {
    setReconciling(true);
    try {
      const res = await fetch("/api/admin/reconcile", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Reconcile failed.");

      toast.success(
        data.checked === 0
          ? "Nothing to reconcile."
          : `${data.checked} checked, ${data.changed} changed${data.failed ? `, ${data.failed} failed` : ""}.`
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reconcile failed.");
    } finally {
      setReconciling(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-card">
        <div className="border-b px-5 py-3.5">
          <h2 className="text-sm font-semibold">Maintenance</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            The worker already does this on a loop. These are for when you don&apos;t want to
            wait.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <p className="text-sm font-medium">Reconcile everyone</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Ask Stripe what&apos;s true and make the database agree. Safe to press twice.
            </p>
          </div>
          <Button variant="secondary" size="lg" disabled={reconciling} onClick={reconcile}>
            {reconciling ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
            Reconcile now
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t p-5">
          <div>
            <p className="text-sm font-medium">Check Plex</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Confirms the token, the server, the shared libraries and the share list. Reads
              only.
            </p>
          </div>
          <Button variant="secondary" size="lg" disabled={checking} onClick={runCheck}>
            {checking ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}
            Run check
          </Button>
        </div>
      </section>

      {check && <PlexResult check={check} />}

      <section className="rounded-xl border bg-card">
        <div className="border-b px-5 py-3.5">
          <h2 className="text-sm font-semibold">Protected Plex accounts</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {protectedCount} account{protectedCount === 1 ? "" : "s"} this system will never
            touch: no share revocation, no stream kills, no exceptions.
          </p>
        </div>
        <p className="p-5 text-sm text-muted-foreground">
          These predate CineVault and are shared with directly. To the system they look exactly
          like people who never paid, which is why the rail exists. Run the Plex check above to
          see which of them currently hold a share.
        </p>
        <p className="border-t px-5 py-3 text-xs text-muted-foreground">
          Set by PLEX_PROTECTED_USERS. Changing it is a deploy, deliberately: this is not a
          list anybody should be able to edit from a browser.
        </p>
      </section>
    </div>
  );
}

function PlexResult({ check }: { check: PlexCheck }) {
  if (!check.configured) {
    return (
      <section className="rounded-xl border border-destructive/30 bg-card p-5">
        <p className="flex items-center gap-2 text-sm text-destructive">
          <TriangleAlert className="size-4" />
          Plex is not configured. Nobody can be granted or revoked access.
        </p>
      </section>
    );
  }

  if (check.error) {
    return (
      <section className="rounded-xl border border-destructive/30 bg-card p-5">
        <p className="flex items-start gap-2 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            Plex check failed: {check.error}
          </span>
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b px-5 py-3.5">
        <CircleCheck className="size-4 text-success" />
        <h2 className="text-sm font-semibold">
          Plex is reachable as {check.owner?.username}
        </h2>
      </div>

      <div className="grid gap-px bg-border sm:grid-cols-3">
        <Stat label="Shared" value={String(check.libraries?.shared.length ?? 0)} />
        <Stat label="Not shared" value={String(check.libraries?.excluded.length ?? 0)} />
        <Stat label="Accounts with access" value={String(check.shares?.length ?? 0)} />
      </div>

      <div className="grid gap-5 p-5 md:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Shared libraries
          </h3>
          <ul className="mt-2 space-y-1 text-sm">
            {check.libraries?.shared.map((title) => (
              <li key={title} className="flex items-center gap-2">
                <CircleCheck className="size-3.5 shrink-0 text-success" />
                {title}
              </li>
            ))}
          </ul>

          {(check.libraries?.excluded.length ?? 0) > 0 && (
            <>
              <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Not shared
              </h3>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {check.libraries?.excluded.map((title) => (
                  <li key={title} className="flex items-center gap-2">
                    <CircleX className="size-3.5 shrink-0" />
                    {title}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Currently shared with
          </h3>
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-sm">
            {check.shares?.map((share) => (
              <li key={share.name} className="flex items-center justify-between gap-2">
                <span className={cn(share.protected && "text-muted-foreground")}>
                  {share.name}
                </span>
                {share.protected && (
                  <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    protected
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* The env var is named for section ids but holds library keys. Showing the translation
          is the fastest way to see that the mapping is right. */}
      <div className="border-t px-5 py-3 text-xs text-muted-foreground">
        PLEX_LIBRARY_SECTION_IDS holds {check.configuredValues?.join(", ")} (library keys),
        resolved to plex.tv section ids {check.resolvedIds?.join(", ")}.
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-5 py-3.5">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
