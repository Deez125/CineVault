"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AnnouncementPreview } from "@/components/app/announcements";
import { SEVERITIES } from "@/lib/announcement-types";
import { toneOf } from "@/components/app/announcement-tones";
import { cn } from "@/lib/utils";

export type AdminAnnouncement = {
  id: string;
  title: string;
  body: string | null;
  severity: string;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  dismissals: number;
};

export function AnnouncementsClient({ items }: { items: AdminAnnouncement[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<AdminAnnouncement | "new" | null>(null);
  const [deleting, setDeleting] = useState<AdminAnnouncement | null>(null);
  const [busy, setBusy] = useState(false);

  async function call(url: string, method: string, body?: unknown) {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "That didn't work.");
      router.refresh();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That didn't work.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button size="lg" onClick={() => setEditing("new")}>
          <Plus />
          New announcement
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="rounded-xl border bg-card px-5 py-16 text-center text-sm text-muted-foreground">
          Nothing posted. An announcement shows at the top of everyone&apos;s dashboard until
          they close it.
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id} className="rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {/* The real banner, so what you see here is exactly what members get. */}
                  <div className={cn(!item.active && "opacity-50")}>
                    <AnnouncementPreview
                      announcement={{
                        id: item.id,
                        title: item.title,
                        body: item.body,
                        severity: item.severity,
                      }}
                    />
                  </div>

                  <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-xs text-muted-foreground">
                    <span className={item.active ? "text-success" : undefined}>
                      {item.active ? "Live" : "Off"}
                    </span>
                    <span aria-hidden>·</span>
                    <span>{window_(item)}</span>
                    <span aria-hidden>·</span>
                    <span>
                      {item.dismissals} dismissal{item.dismissals === 1 ? "" : "s"}
                    </span>
                  </p>
                </div>

                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      call(`/api/admin/announcements/${item.id}`, "PATCH", {
                        active: !item.active,
                      })
                    }
                  >
                    {item.active ? "Turn off" : "Turn on"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Edit"
                    onClick={() => setEditing(item)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete"
                    onClick={() => setDeleting(item)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <EditDialog
        key={editing === "new" ? "new" : (editing?.id ?? "closed")}
        target={editing}
        busy={busy}
        onClose={() => setEditing(null)}
        onSave={async (values) => {
          const ok =
            editing === "new"
              ? await call("/api/admin/announcements", "POST", values)
              : await call(`/api/admin/announcements/${editing?.id}`, "PATCH", values);

          if (ok) {
            setEditing(null);
            toast.success(editing === "new" ? "Posted." : "Saved.");
          }
        }}
      />

      <Dialog open={Boolean(deleting)} onOpenChange={(open) => !open && !busy && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this announcement?</DialogTitle>
            <DialogDescription>
              It disappears from everyone&apos;s dashboard. If you only want to stop showing
              it, turn it off instead and it can come back.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border bg-muted/40 p-3 text-sm font-medium">
            {deleting?.title}
          </div>

          <DialogFooter>
            <DialogClose
              render={
                <Button variant="secondary" size="lg" disabled={busy}>
                  Never mind
                </Button>
              }
            />
            <Button
              variant="destructive"
              size="lg"
              disabled={busy}
              onClick={async () => {
                if (!deleting) return;
                const ok = await call(`/api/admin/announcements/${deleting.id}`, "DELETE");
                if (ok) {
                  setDeleting(null);
                  toast.success("Deleted.");
                }
              }}
            >
              {busy && <LoaderCircle className="animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function window_(item: AdminAnnouncement): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  if (item.startsAt && item.endsAt) return `${fmt(item.startsAt)} to ${fmt(item.endsAt)}`;
  if (item.startsAt) return `from ${fmt(item.startsAt)}`;
  if (item.endsAt) return `until ${fmt(item.endsAt)}`;
  return "no end date";
}

/** `datetime-local` wants `YYYY-MM-DDTHH:mm` in LOCAL time, not an ISO string in UTC. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function EditDialog({
  target,
  busy,
  onClose,
  onSave,
}: {
  target: AdminAnnouncement | "new" | null;
  busy: boolean;
  onClose: () => void;
  onSave: (values: Record<string, unknown>) => void;
}) {
  const existing = target && target !== "new" ? target : null;

  const [title, setTitle] = useState(existing?.title ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [severity, setSeverity] = useState(existing?.severity ?? "info");
  const [startsAt, setStartsAt] = useState(toLocalInput(existing?.startsAt ?? null));
  const [endsAt, setEndsAt] = useState(toLocalInput(existing?.endsAt ?? null));
  const [resurface, setResurface] = useState(false);

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit announcement" : "New announcement"}</DialogTitle>
          <DialogDescription>
            Shows at the top of every member&apos;s dashboard until they close it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="a-title">Title</Label>
            <Input
              id="a-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder="Server maintenance on Sunday"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="a-body">Details (optional)</Label>
            <textarea
              id="a-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Expect an hour of downtime from about 9pm."
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>

          <div className="space-y-2">
            <Label>Tone</Label>
            {/* Each option wears its own colour and icon, so picking one shows what it will
                actually look like. A uniform blue outline told you nothing about what
                "urgent" renders as. */}
            <div className="flex flex-wrap gap-2">
              {SEVERITIES.map((option) => {
                const tone = toneOf(option);
                const Icon = tone.icon;
                const active = severity === option;

                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setSeverity(option)}
                    aria-pressed={active}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors",
                      active
                        ? tone.selected
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <Icon className={cn("size-3.5", active ? tone.icon_ : undefined)} />
                    {tone.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="a-start">Show from (optional)</Label>
              <Input
                id="a-start"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="a-end">Show until (optional)</Label>
              <Input
                id="a-end"
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </div>
          </div>

          {existing && existing.dismissals > 0 && (
            <label className="flex items-start gap-2.5 rounded-lg border bg-muted/40 p-3 text-sm">
              <input
                type="checkbox"
                checked={resurface}
                onChange={(e) => setResurface(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Show it again to the {existing.dismissals} who already closed it.
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Leave this off for a typo fix. Turn it on when the notice says something new.
                </span>
              </span>
            </label>
          )}
        </div>

        <DialogFooter>
          <DialogClose
            render={
              <Button variant="secondary" size="lg" disabled={busy}>
                Cancel
              </Button>
            }
          />
          <Button
            size="lg"
            disabled={busy || !title.trim()}
            onClick={() =>
              onSave({
                title,
                body,
                severity,
                active: true,
                startsAt: startsAt || null,
                endsAt: endsAt || null,
                ...(existing ? { resurface } : {}),
              })
            }
          >
            {busy && <LoaderCircle className="animate-spin" />}
            {existing ? "Save" : "Post it"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
