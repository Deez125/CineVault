"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CircleCheck,
  Clapperboard,
  ExternalLink,
  Film,
  LoaderCircle,
  Music,
  Tv,
  TriangleAlert,
  Unlink,
} from "lucide-react";
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
import { cn } from "@/lib/utils";

export type PlexLibrary = { id: string; title: string; type: string };

type PlexState = {
  plexUsername: string | null;
  shareState: string;
  isMember: boolean;
  streamLimit: number;
};

const SERVER_NAME = "CineVault (Server 1)";

export function PlexClient({
  state,
  libraries,
}: {
  state: PlexState;
  libraries: PlexLibrary[];
}) {
  const [unlinking, setUnlinking] = useState(false);
  const [going, setGoing] = useState(false);

  const linked = Boolean(state.plexUsername);
  const shared = state.shareState === "invited";

  return (
    <>
      <div className="grid gap-5 xl:grid-cols-3">
        {/* ── The account, and whatever the next step is ───────────────────── */}
        <section className="rounded-xl border bg-card xl:col-span-2">
          {linked ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4 border-b p-6">
                <div className="flex items-center gap-4">
                  <span
                    className="flex size-12 shrink-0 items-center justify-center rounded-full"
                    style={{ background: "color-mix(in oklch, var(--plex) 18%, transparent)" }}
                  >
                    <FaAngleRight className="size-5 text-plex" />
                  </span>
                  <div>
                    <div className="text-xl font-semibold">{state.plexUsername}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-sm">
                      {shared ? (
                        <>
                          <CircleCheck className="size-4 text-success" />
                          <span className="text-muted-foreground">
                            Shared with {SERVER_NAME}
                          </span>
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
                </div>

                <div className="flex flex-wrap gap-2">
                  {shared && (
                    <Button
                      size="lg"
                      className="bg-plex text-plex-foreground hover:bg-plex/90"
                      render={<a href="https://app.plex.tv" target="_blank" rel="noreferrer" />}
                    >
                      Open Plex
                      <ExternalLink />
                    </Button>
                  )}
                  <Button variant="secondary" size="lg" onClick={() => setUnlinking(true)}>
                    <Unlink />
                    Unlink
                  </Button>
                </div>
              </div>

              <dl className="grid gap-px bg-border sm:grid-cols-3">
                <Stat label="Watching at once" value={state.isMember ? String(state.streamLimit) : "—"} />
                <Stat label="Libraries" value={libraries.length ? String(libraries.length) : "—"} />
                <Stat
                  label="Access"
                  value={shared ? "Ready" : state.isMember ? "Pending" : "No plan"}
                  tone={shared ? "success" : state.isMember ? "warning" : "muted"}
                />
              </dl>

              <p className="p-6 text-xs leading-relaxed text-muted-foreground">
                Linked the wrong account? Unlink it and sign in with a different one. Your
                subscription isn&apos;t affected, and you&apos;ll be invited straight back in.
              </p>
            </>
          ) : (
            <div className="flex h-full flex-col justify-center p-8 sm:p-10">
              <span
                className="flex size-14 items-center justify-center rounded-2xl"
                style={{ background: "color-mix(in oklch, var(--plex) 18%, transparent)" }}
              >
                <FaAngleRight className="size-7 text-plex" />
              </span>

              <h2 className="mt-6 text-2xl font-semibold tracking-tight">
                Connect your Plex account
              </h2>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                Plex has no invite links, so we need to know which account to share with. You
                sign in on Plex&apos;s own site, we learn your username, and the invite goes
                out. We never see your password.
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Button
                  size="lg"
                  className="bg-plex text-plex-foreground hover:bg-plex/90"
                  disabled={going}
                  onClick={() => setGoing(true)}
                  render={<a href="/api/plex/start" />}
                >
                  {going ? <LoaderCircle className="animate-spin" /> : <FaAngleRight />}
                  Sign in with Plex
                </Button>

                <span className="text-xs text-muted-foreground">
                  Don&apos;t have Plex?{" "}
                  <a
                    href="https://plex.tv"
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    Make a free account
                  </a>{" "}
                  first.
                </span>
              </div>
            </div>
          )}
        </section>

        {/* ── What's actually in there ─────────────────────────────────────── */}
        <section className="rounded-xl border bg-card">
          <div className="border-b px-5 py-3.5">
            <h2 className="text-sm font-semibold">Included libraries</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Every plan gets all of them
            </p>
          </div>

          {libraries.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">
              Library list is unavailable right now.
            </p>
          ) : (
            <ul className="max-h-[22rem] overflow-y-auto">
              {libraries.map((library) => (
                <li
                  key={library.id}
                  className="flex items-center gap-2.5 border-b px-5 py-2.5 text-sm last:border-0"
                >
                  <LibraryIcon type={library.type} />
                  <span className="truncate">{library.title}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ── How this works ───────────────────────────────────────────────────── */}
      <div className="mt-5 grid gap-5 md:grid-cols-3">
        <Step
          n={1}
          title="Sign in with Plex"
          body="On Plex's own site. It takes one click if you're already signed in there."
          done={linked}
        />
        <Step
          n={2}
          title="We share the libraries"
          body="An invite lands in your Plex account as soon as you have an active plan."
          done={shared}
        />
        <Step
          n={3}
          title="Accept and watch"
          body="Open Plex, accept the invite, and the libraries appear alongside your own."
          done={false}
        />
      </div>

      <UnlinkDialog
        key={`unlink-${unlinking}`}
        open={unlinking}
        onOpenChange={setUnlinking}
        plexUsername={state.plexUsername}
      />
    </>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "success" | "warning" | "muted";
}) {
  const tones = {
    default: "",
    success: "text-success",
    warning: "text-warning",
    muted: "text-muted-foreground",
  };

  return (
    <div className="bg-card px-6 py-4">
      <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className={cn("mt-1 text-lg font-semibold tabular-nums", tones[tone])}>{value}</dd>
    </div>
  );
}

/** Plex reports a section type; showing the right icon costs nothing and reads faster. */
function LibraryIcon({ type }: { type: string }) {
  const className = "size-4 shrink-0 text-muted-foreground";

  if (type === "show") return <Tv className={className} />;
  if (type === "artist") return <Music className={className} />;
  if (type === "movie") return <Film className={className} />;
  return <Clapperboard className={className} />;
}

function Step({
  n,
  title,
  body,
  done,
}: {
  n: number;
  title: string;
  body: string;
  done: boolean;
}) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
            done ? "bg-success text-success-foreground" : "bg-muted text-muted-foreground"
          )}
        >
          {done ? <CircleCheck className="size-3.5" /> : n}
        </span>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{body}</p>
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
