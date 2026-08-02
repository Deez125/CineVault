"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Plus } from "lucide-react";
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
import {
  CATEGORIES,
  CATEGORY_HINT,
  CATEGORY_LABEL,
  PRIORITIES,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  type Category,
  type Priority,
} from "@/lib/ticket-types";
import { cn } from "@/lib/utils";

export function NewTicketButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<Category>("general");
  const [priority, setPriority] = useState<Priority>("normal");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject, body, priority, category }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't open that ticket.");

      setOpen(false);
      // Straight into the conversation. Making somebody find the thing they just created in
      // a list is a small indignity that adds up.
      router.push(`/dashboard/support/${data.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't open that ticket.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="lg" onClick={() => setOpen(true)}>
        <Plus />
        New ticket
      </Button>

      <Dialog
        key={String(open)}
        open={open}
        onOpenChange={(next) => !busy && setOpen(next)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>What&apos;s going on?</DialogTitle>
            <DialogDescription>
              We&apos;ll reply here, and you&apos;ll see it without needing to refresh.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="subject">Subject</Label>
              <Input
                id="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={120}
                placeholder="subject"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label>What&apos;s it about?</Label>
              <div className="grid grid-cols-2 gap-2">
                {CATEGORIES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setCategory(option)}
                    aria-pressed={category === option}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left transition-colors",
                      category === option
                        ? "border-primary bg-primary/10"
                        : "hover:border-foreground/25 hover:bg-muted/40"
                    )}
                  >
                    <span className="block text-sm">{CATEGORY_LABEL[option]}</span>
                    <span className="block text-xs text-muted-foreground">
                      {CATEGORY_HINT[option]}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>How urgent?</Label>
              {/* Their word on urgency, not ours. It tells an admin which of five open
                  tickets to read first, and somebody marking everything urgent is itself
                  worth knowing. */}
              <div className="flex flex-wrap gap-2">
                {PRIORITIES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setPriority(option)}
                    aria-pressed={priority === option}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                      priority === option
                        ? cn("border-current bg-muted/40", PRIORITY_TONE[option])
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {PRIORITY_LABEL[option]}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="body">Details</Label>
              <textarea
                id="body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={5}
                maxLength={5000}
                placeholder="What happened, and what you expected instead."
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>
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
              disabled={busy || subject.trim().length < 3 || body.trim().length < 5}
              onClick={submit}
            >
              {busy && <LoaderCircle className="animate-spin" />}
              Open ticket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
