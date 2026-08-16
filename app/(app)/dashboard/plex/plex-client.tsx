"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CircleCheck,
  Clapperboard,
  ExternalLink,
  Film,
  LoaderCircle,
  Lock,
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
import { formatStreamLimit, isUnlimited } from "@/lib/plans";
import { useMySessions } from "@/hooks/use-my-sessions";
import { SessionsPanel } from "@/components/app/sessions-panel";

export type PlexLibrary = { id: string; title: string; type: string };

type PlexState = {
  plexUsername: string | null;
  shareState: string;
  isMember: boolean;
  isAdmin: boolean;
  streamLimit: number;
};

const SERVER_NAME = "CineVault (Server 1)";

export function PlexClient({
  state,
  libraries,
  libraryCount,
}: {
  state: PlexState;
  /** Empty for non-members: the titles are never sent to them at all. */
  libraries: PlexLibrary[];
  /** How many there are. Safe to show to anybody, and it is a selling point. */
  libraryCount: number;
}) {
  const [unlinking, setUnlinking] = useState(false);
  const [going, setGoing] = useState(false);

  const linked = Boolean(state.plexUsername);
  const shared = state.shareState === "invited";

  // Hoisted here rather than inside SessionsPanel — the same live count is rendered in the
  // Stat card above the panel, and two independent hook instances would poll twice per tick.
  // The panel receives this as its `data` prop and skips its own polling.
  const sessionsData = useMySessions({ enabled: state.isMember && shared });

  /**
   * The owner's own account, not a guest of it.
   *
   * Almost everything on this page describes a journey an admin never takes: an invite going
   * out, waiting for it, accepting it. They already have the server — linking here only tells
   * the app who they are on Plex.
   */
  const owner = state.isAdmin;

  /**
   * Whether Plex says the invite has been accepted.
   *
   * Held HERE rather than inside the panel that shows it, because step 3 of the walkthrough
   * asks the same question. Two components fetching it separately would be two answers that
   * can differ, and a tick on the step while the panel still offers the button is exactly the
   * sort of contradiction people notice.
   *
   * "idle" means there is nothing to ask about yet — no share, so no invite.
   */
  const [invite, setInvite] = useState<InviteState>(shared ? "checking" : "idle");

  /**
   * The invite state, but only ever believed while a share actually exists.
   *
   * `invite` is a fetched answer that outlives the question. Unlinking re-renders the server
   * components — plexUsername goes null, `shared` goes false — but this client component is
   * not remounted, so a stale "accepted" survived and step 3 kept its green tick on a page
   * otherwise saying the account was not linked at all.
   *
   * Deriving it means the contradiction cannot happen: no share, no answer.
   */
  const inviteState: InviteState = shared ? invite : "idle";

  useEffect(() => {
    if (!shared) return;
    let cancelled = false;

    fetch("/api/plex/invite")
      .then((res) => res.json())
      .then((body) => !cancelled && setInvite(body.state ?? "unknown"))
      // A failed check is not a failed invite. Say we could not tell.
      .catch(() => !cancelled && setInvite("unknown"));

    return () => {
      cancelled = true;
    };
  }, [shared]);

  return (
    <>
      <div className="grid gap-5 xl:grid-cols-3">
        {/* ── The account, and whatever the next step is ───────────────────── */}
        <section className="rounded-xl border bg-card xl:col-span-2">
          {linked ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4 border-b p-6">
                <div>
                  <div className="flex items-center gap-2">
                    <FaAngleRight className="size-5 shrink-0 text-plex" />
                    <span className="text-xl font-semibold">{state.plexUsername}</span>
                  </div>

                  <div className="mt-1 flex items-center gap-1.5 text-sm">
                    {owner ? (
                      <>
                        <CircleCheck className="size-4 text-success" />
                        <span className="text-muted-foreground">
                          You own {SERVER_NAME}
                        </span>
                      </>
                    ) : shared ? (
                      <>
                        <CircleCheck className="size-4 text-success" />
                        <span className="text-muted-foreground">Shared with {SERVER_NAME}</span>
                      </>
                    ) : state.isMember ? (
                      <span className="text-warning">Invite hasn&apos;t gone out yet</span>
                    ) : (
                      <Link
                        href="/dashboard/billing"
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        Choose a plan to get access
                      </Link>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {(shared || owner) && (
                    <Button
                      size="lg"
                      className="bg-plex text-plex-foreground hover:bg-plex/90"
                      render={<a href="https://app.plex.tv" target="_blank" rel="noreferrer" />}
                    >
                      <FaAngleRight />
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
                <Stat
                  label="Watching at once"
                  value={watchingAtOnceLabel(state, sessionsData.allowance?.used ?? 0)}
                />
                <Stat label="Libraries" value={libraryCount ? String(libraryCount) : "—"} />
                <Stat
                  label="Access"
                  value={owner ? "Owner" : shared ? "Ready" : state.isMember ? "Pending" : "No plan"}
                  tone={owner || shared ? "success" : state.isMember ? "warning" : "muted"}
                />
              </dl>

              {shared && <InvitePanel state={inviteState} />}

              <p className="p-6 text-xs leading-relaxed text-muted-foreground">
                {owner
                  ? "Linked the wrong account? Unlink it and sign in with a different one. Nothing is shared or removed on your behalf — this only tells CineVault who you are on Plex."
                  : "Linked the wrong account? Unlink it and sign in with a different one. Your subscription isn't affected, and you'll be invited straight back in."}
              </p>
            </>
          ) : (
            <div className="flex h-full flex-col justify-center p-8 sm:p-10">
              <h2 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
                <FaAngleRight className="size-6 shrink-0 text-plex" />
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
            {/* The plan changes how many people can watch at once, never what is available.
                Saying "included with every plan" implied the libraries were the thing being
                sold in tiers, which is exactly backwards. */}
            <p className="mt-0.5 text-xs text-muted-foreground">
              {state.isMember
                ? "The same libraries on every plan"
                : `The same ${libraryCount} libraries on every plan`}
            </p>
          </div>

          {!state.isMember ? (
            <RedactedLibraries count={libraryCount} />
          ) : libraries.length === 0 ? (
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

      {/* ── Live sessions ────────────────────────────────────────────────────
          The full "watching now" panel: rich cards per stream, live x/y in the header. Only
          rendered once the share is actually active — before that there is nothing they
          could be watching, and showing "0/N" would suggest the wait is over when it isn't. */}
      {shared && (
        <div className="mt-5">
          <SessionsPanel
            isMember={state.isMember}
            streamLimit={state.streamLimit}
            data={sessionsData}
          />
        </div>
      )}

      {/* ── How this works ───────────────────────────────────────────────────
          Hidden from the owner. Every step describes something that happens TO a guest —
          an invite going out, waiting for it, accepting it — and none of it happens to the
          person whose server it is. Showing it anyway would be instructions for somebody
          else's situation. */}
      {!owner && (
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
            title={inviteState === "accepted" ? "Accepted — go and watch" : "Accept and watch"}
            body={
              inviteState === "accepted"
                ? "The libraries are on your Plex account, alongside your own."
                : "Open Plex, accept the invite, and the libraries appear alongside your own."
            }
            done={inviteState === "accepted"}
          />
        </div>
      )}

      <UnlinkDialog
        key={`unlink-${unlinking}`}
        open={unlinking}
        onOpenChange={setUnlinking}
        plexUsername={state.plexUsername}
      />
    </>
  );
}

/**
 * The Stat's headline value: "1/3", "Unlimited", or "—" when there is no plan.
 *
 * For an admin (unlimited) the fraction would be meaningless — "1/∞" reads as a bug. Members
 * see live-updating x/y. Non-members see nothing at all because the whole Stat row is only
 * rendered inside the "linked" branch anyway.
 */
function watchingAtOnceLabel(
  state: { isMember: boolean; streamLimit: number },
  used: number
): string {
  if (!state.isMember) return "—";
  if (isUnlimited(state.streamLimit)) return formatStreamLimit(state.streamLimit);
  return `${used}/${state.streamLimit}`;
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

/**
 * The library list for somebody without a plan.
 *
 * The bars are placeholders, not hidden text. The real titles were never sent to this
 * browser, so there is nothing to reveal by inspecting the page — which is the difference
 * between actually withholding something and merely making it inconvenient to read.
 *
 * The count is shown on purpose. "Ten libraries you can't see yet" is a reason to subscribe;
 * an empty box is just a broken panel.
 */
function RedactedLibraries({ count }: { count: number }) {
  // Varied widths so it reads as a list of names rather than a loading skeleton.
  const widths = ["72%", "58%", "80%", "64%", "76%", "54%", "68%", "84%", "60%", "74%"];
  const rows = Math.max(count, 6);

  return (
    <div className="relative">
      <ul aria-hidden className="max-h-[22rem] overflow-hidden">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="flex items-center gap-2.5 border-b px-5 py-2.5 last:border-0">
            <span className="size-4 shrink-0 rounded-sm bg-muted-foreground/25" />
            <span
              className="h-3.5 rounded-sm bg-muted-foreground/20"
              style={{ width: widths[i % widths.length] }}
            />
          </li>
        ))}
      </ul>

      {/* A solid panel rather than a fade. The rows are already obviously placeholders, so
          the fade was only softening an edge that did not need softening. */}
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-2.5 border-t bg-card p-5">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="size-3.5" />
          Subscribe to see what&apos;s inside
        </p>
        <Button size="sm" render={<Link href="/dashboard/billing" />}>
          Choose a plan
        </Button>
      </div>
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


/**
 * What Plex says about the invite.
 *
 *   idle      nothing shared yet, so nothing to ask
 *   checking  asking
 *   accepted  they are in
 *   pending   invited, not yet accepted
 *   none      Plex has no share for them at all
 *   unknown   the check itself failed — NOT the same as "not accepted"
 */
type InviteState = "idle" | "checking" | "accepted" | "pending" | "none" | "unknown";

/** Where Plex sends an invite to be accepted. */
const PLEX_INVITES_URL = "https://app.plex.tv/desktop/#!/settings/manage-library-access";

/**
 * Has the invite actually been accepted?
 *
 * Worth asking, because "we sent it" and "they have it" are different facts and only Plex
 * knows the second one. Plex auto-accepts for anybody who has previously accepted a share
 * from this server, so a good share of members will never see the button at all — which is
 * precisely why guessing either way would be wrong.
 *
 * Checked on mount rather than rendered from the server, so the page appears immediately and
 * the slow part (listing every share on the server) resolves underneath a spinner instead of
 * holding up the whole page.
 */
function InvitePanel({ state }: { state: InviteState }) {
  if (state === "idle") return null;

  if (state === "checking") {
    return (
      <div className="flex items-center gap-2 border-t p-6 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        Checking your Plex invite
      </div>
    );
  }

  if (state === "accepted") {
    return (
      <div className="flex items-center gap-2 border-t p-6 text-sm">
        <CircleCheck className="size-4 shrink-0 text-success" />
        <span>
          <span className="font-medium">Invite accepted.</span>{" "}
          <span className="text-muted-foreground">
            The library is on your Plex account — nothing else to do.
          </span>
        </span>
      </div>
    );
  }

  // pending, none, or we could not tell. All three are answered by the same button: go and
  // look. Offering it when unsure is the safe direction — the page it opens is harmless, and
  // the alternative is telling somebody they are fine when they might not be.
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t p-6">
      <p className="text-sm text-muted-foreground">
        {state === "pending"
          ? "Your invite is waiting to be accepted. Open Plex to accept it, or check your email."
          : state === "unknown"
            ? "We couldn't check your invite just now. Accept it in Plex, or check your email."
            : "No invite found yet. If one was sent, accept it in Plex or check your email."}
      </p>

      <Button
        size="lg"
        className="bg-plex text-plex-foreground hover:bg-plex/90"
        render={<a href={PLEX_INVITES_URL} target="_blank" rel="noreferrer" />}
      >
        Accept in Plex
        <ExternalLink />
      </Button>
    </div>
  );
}
