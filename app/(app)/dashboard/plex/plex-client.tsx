"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, ExternalLink, LoaderCircle, TriangleAlert, Unlink } from "lucide-react";
// The one place react-icons is used. Lucide is the icon set everywhere else; this is a brand
// mark, and Plex's chevron is not something a generic set has.
import { FaAngleRight } from "react-icons/fa";
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
  const [unlinking, setUnlinking] = useState(false);
  const [going, setGoing] = useState(false);

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
              Linked the wrong account? Unlink it and sign in with a different one. Your
              subscription isn&apos;t affected.
            </p>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm">
              Sign in with Plex and we&apos;ll invite you to the CineVault server.
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              You sign in on Plex&apos;s own site. We never see your password.
            </p>

            {/* A plain link, not a fetch. The whole point is to navigate to Plex and be
                forwarded back, so this must be a real navigation the browser owns. */}
            {/* Plex's own yellow, from the colour index, so it reads as "this takes you to
                Plex" rather than as another primary action. The icon and label inherit
                --plex-foreground, which is dark because white on #ebaf00 is unreadable. */}
            <Button
              size="lg"
              className="mt-5 w-full bg-plex text-plex-foreground hover:bg-plex/90 sm:w-auto"
              disabled={going}
              onClick={() => setGoing(true)}
              render={<a href="/api/plex/start" />}
            >
              {going ? <LoaderCircle className="animate-spin" /> : <FaAngleRight />}
              Sign in with Plex
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

      <UnlinkDialog
        key={`unlink-${unlinking}`}
        open={unlinking}
        onOpenChange={setUnlinking}
        plexUsername={state.plexUsername}
      />
    </div>
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

        <div className="rounded-lg border bg-muted/40 p-4 text-sm font-medium">{plexUsername}</div>

        <p className="text-sm text-muted-foreground">
          Your subscription isn&apos;t affected. Sign in with a different Plex account whenever
          you like and you&apos;ll be invited straight back in.
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
