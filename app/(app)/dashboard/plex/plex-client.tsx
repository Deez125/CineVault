"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CircleCheck,
  Copy,
  ExternalLink,
  Link2,
  LoaderCircle,
  TriangleAlert,
  Unlink,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type PlexState = {
  plexUsername: string | null;
  shareState: string;
  isMember: boolean;
};

export function PlexClient({ state }: { state: PlexState }) {
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState(false);

  const linked = Boolean(state.plexUsername);
  const shared = state.shareState === "invited";

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-card p-5">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Plex account
        </div>

        {linked ? (
          <>
            <div className="mt-3 flex items-start justify-between gap-4">
              <div>
                <div className="text-xl font-semibold">{state.plexUsername}</div>
                <div className="mt-1 flex items-center gap-1.5 text-sm">
                  {shared ? (
                    <>
                      <CircleCheck className="size-4 text-success" />
                      <span className="text-muted-foreground">Invited to the server</span>
                    </>
                  ) : state.isMember ? (
                    <span className="text-warning">Invite hasn&apos;t gone out yet</span>
                  ) : (
                    <span className="text-muted-foreground">
                      Waiting on a plan before the invite goes out
                    </span>
                  )}
                </div>
              </div>

              <Button variant="secondary" size="lg" onClick={() => setUnlinking(true)}>
                <Unlink />
                Unlink
              </Button>
            </div>

            {shared && (
              <Button
                size="lg"
                className="mt-5 w-full sm:w-auto"
                render={<a href="https://app.plex.tv" target="_blank" rel="noreferrer" />}
              >
                Open Plex
                <ExternalLink />
              </Button>
            )}

            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              Linked the wrong account? Unlink it and connect a different one. Your
              subscription isn&apos;t affected.
            </p>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm">
              Connect your Plex account and we&apos;ll invite you to the CineVault server.
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              You&apos;ll enter a short code at plex.tv. We never see your password.
            </p>

            <Button size="lg" className="mt-5 w-full sm:w-auto" onClick={() => setLinking(true)}>
              <Link2 />
              Link my Plex
            </Button>

            <p className="mt-3 text-xs text-muted-foreground">
              Don&apos;t have Plex? Make a free account at{" "}
              <a
                href="https://plex.tv"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                plex.tv
              </a>{" "}
              first.
            </p>
          </>
        )}
      </section>

      <LinkDialog key={`link-${linking}`} open={linking} onOpenChange={setLinking} />
      <UnlinkDialog
        key={`unlink-${unlinking}`}
        open={unlinking}
        onOpenChange={setUnlinking}
        plexUsername={state.plexUsername}
      />
    </div>
  );
}

/**
 * The device-PIN flow.
 *
 * Show a 4-character code, then poll until Plex says the member has entered it at
 * plex.tv/link. There is no way to push them a link and no way to know they are done other
 * than asking, so polling is the flow, not a workaround.
 */
function LinkDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [code, setCode] = useState<string | null>(null);
  const [pinId, setPinId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ plexUsername: string; warning?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    fetch("/api/plex/link", { method: "POST" })
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (body.error) throw new Error(body.error);
        setCode(body.code);
        setPinId(body.pinId);
      })
      .catch((err) => !cancelled && setError(err.message));

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!pinId || done || error) return;

    let stopped = false;

    const timer = setInterval(async () => {
      try {
        const res = await fetch("/api/plex/poll", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pinId }),
        });
        const body = await res.json();
        if (stopped) return;

        if (body.error) {
          setError(body.error);
          clearInterval(timer);
          return;
        }

        if (body.linked) {
          setDone({ plexUsername: body.plexUsername, warning: body.warning });
          clearInterval(timer);
          // Let them see it worked before the dialog closes under them.
          setTimeout(() => {
            onOpenChange(false);
            router.refresh();
            toast.success(`Linked as ${body.plexUsername}`);
          }, 1600);
        }
      } catch {
        // A blip shouldn't end the flow.
      }
    }, 2500);

    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [pinId, done, error, onOpenChange, router]);

  useEffect(() => () => void (copyTimer.current && clearTimeout(copyTimer.current)), []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link your Plex account</DialogTitle>
          <DialogDescription>We never see your Plex password.</DialogDescription>
        </DialogHeader>

        {error ? (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : done ? (
          <div className="py-6 text-center">
            <CircleCheck className="mx-auto size-10 text-success" />
            <p className="mt-4 font-medium">Linked as {done.plexUsername}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {done.warning ?? "Your invite is on its way. Accept it at app.plex.tv."}
            </p>
          </div>
        ) : !code ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            Getting your code
          </div>
        ) : (
          <>
            <ol className="space-y-4 text-sm">
              <li className="flex gap-3">
                <Step n={1} />
                <a
                  href="https://plex.tv/link"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
                >
                  Open plex.tv/link
                  <ExternalLink className="size-3.5" />
                </a>
              </li>

              <li className="flex gap-3">
                <Step n={2} />
                <div className="flex-1">
                  <p>Enter this code:</p>
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(code);
                      setCopied(true);
                      copyTimer.current = setTimeout(() => setCopied(false), 1500);
                    }}
                    className="mt-2 flex w-full items-center justify-center gap-3 rounded-lg border bg-muted/40 py-4 transition-colors hover:border-primary/40"
                    title="Copy"
                  >
                    <span className="font-mono text-3xl font-bold tracking-[0.3em] text-primary">
                      {code}
                    </span>
                    {copied ? (
                      <Check className="size-4 text-success" />
                    ) : (
                      <Copy className="size-4 text-muted-foreground" />
                    )}
                  </button>
                </div>
              </li>

              <li className="flex gap-3">
                <Step n={3} />
                <p>Sign in with the Plex account you want to watch on.</p>
              </li>
            </ol>

            <div className="mt-2 flex items-center justify-center gap-2 border-t pt-4 text-sm text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" />
              Waiting for you
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs">
      {n}
    </span>
  );
}

function UnlinkDialog({
  open,
  onOpenChange,
  plexUsername,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plexUsername: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/plex/unlink", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Couldn't unlink.");
      onOpenChange(false);
      router.refresh();
      toast.success("Plex account unlinked.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't unlink.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={busy ? () => {} : onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Unlink your Plex account?</DialogTitle>
          <DialogDescription>
            You&apos;ll lose access to the server until you link one again.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="rounded-lg border bg-muted/40 p-4 text-sm font-medium">
          {plexUsername}
        </div>

        <p className="text-sm text-muted-foreground">
          Your subscription isn&apos;t affected. Link a different Plex account whenever you
          like and you&apos;ll be invited straight back in.
        </p>

        <DialogFooter>
          <DialogClose
            render={
              <Button variant="secondary" size="lg" disabled={busy}>
                Never mind
              </Button>
            }
          />
          <Button variant="destructive" size="lg" disabled={busy} onClick={confirm}>
            {busy && <LoaderCircle className="animate-spin" />}
            Unlink
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
