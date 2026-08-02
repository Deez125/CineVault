"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUp,
  CircleCheck,
  LoaderCircle,
  MessageSquare,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { categoryLabel, priorityLabel, priorityTone } from "@/lib/ticket-types";
import { cn } from "@/lib/utils";

export type ThreadMessage = {
  id: number;
  authorRole: string;
  authorName: string;
  body: string;
  createdAt: string;
};

export type ThreadTicket = {
  id: string;
  subject: string;
  status: string;
  priority: string;
  category: string;
  createdAt: string;
  closedAt: string | null;
};

/**
 * A live support conversation, with its details beside it.
 *
 * While the ticket is OPEN this polls for new messages, so a reply lands without anybody
 * being told to refresh. When it closes, polling stops — there is nothing more coming, and a
 * closed ticket left polling is a request every few seconds per open tab, forever.
 *
 * It also stops while the tab is hidden, and catches up in one request on return, because the
 * cursor is a message id rather than a clock.
 */
export function TicketThread({
  ticket: initialTicket,
  initialMessages,
  viewerRole,
}: {
  ticket: ThreadTicket;
  initialMessages: ThreadMessage[];
  /** Which side is reading. Decides which bubbles sit on the right. */
  viewerRole: "user" | "admin";
}) {
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages);
  const [status, setStatus] = useState(initialTicket.status);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [busyStatus, setBusyStatus] = useState(false);

  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  // Read inside the poll without being a dependency of it, which would tear down and rebuild
  // the timer on every single message.
  const lastId = useRef(initialMessages.at(-1)?.id ?? 0);

  const merge = useCallback((incoming: ThreadMessage[]) => {
    if (incoming.length === 0) return;

    setMessages((current) => {
      // The sender already added their own message optimistically and the poll hands it back
      // a moment later. Deduping by id is what stops it appearing twice.
      const seen = new Set(current.map((m) => m.id));
      const fresh = incoming.filter((m) => !seen.has(m.id));
      if (fresh.length === 0) return current;
      return [...current, ...fresh].sort((a, b) => a.id - b.id);
    });

    const highest = incoming.at(-1)?.id ?? 0;
    if (highest > lastId.current) lastId.current = highest;
  }, []);

  useEffect(() => {
    if (status !== "open") return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (stopped || document.hidden) return schedule();

      try {
        const res = await fetch(`/api/tickets/${initialTicket.id}/messages?since=${lastId.current}`, {
          cache: "no-store",
        });
        if (res.ok) {
          const data = await res.json();
          merge(data.messages ?? []);
          if (data.status && data.status !== status) setStatus(data.status);
        }
      } catch {
        // A blip is not the end of the conversation. Try again next tick.
      }

      schedule();
    };

    const schedule = () => {
      if (!stopped) timer = setTimeout(poll, 3000);
    };

    const onVisible = () => {
      if (!document.hidden) void poll();
    };

    document.addEventListener("visibilitychange", onVisible);
    schedule();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [initialTicket.id, status, merge]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  async function send(event?: React.FormEvent) {
    event?.preventDefault();
    const text = body.trim();
    if (!text || sending || closed) return;

    setSending(true);
    try {
      const res = await fetch(`/api/tickets/${initialTicket.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't send that.");

      setBody("");
      // Clearing the value does not shrink a textarea that was manually grown, so it has to
      // be put back by hand or the box stays tall after every long reply.
      if (input.current) {
        input.current.style.height = "auto";
        input.current.focus();
      }
      merge([data.message]);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send that.");
    } finally {
      setSending(false);
    }
  }

  async function changeStatus(next: "open" | "closed") {
    setBusyStatus(true);
    try {
      const res = await fetch(`/api/tickets/${initialTicket.id}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "That didn't work.");

      setStatus(next);
      // The change writes a note into the thread. Pick it up now rather than waiting for a
      // poll that may have just been switched off.
      const fresh = await fetch(`/api/tickets/${initialTicket.id}/messages?since=${lastId.current}`);
      if (fresh.ok) merge((await fresh.json()).messages ?? []);

      toast.success(next === "closed" ? "Ticket closed." : "Ticket reopened.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusyStatus(false);
    }
  }

  const closed = status !== "open";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
      {/* ── The conversation ──────────────────────────────────────────────── */}
      {/* min-w-0 is load-bearing: a flex child defaults to min-width:auto, so this column
          refuses to shrink below its content and pushes the Send button underneath the
          details sidebar instead of wrapping. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-5">
          {messages.map((message, i) => (
            <div key={message.id}>
              {needsDateSeparator(messages, i) && (
                <div className="my-4 flex items-center gap-3">
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {dayLabel(message.createdAt)}
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              )}

              {message.authorRole === "system" ? (
                <p className="py-2 text-center text-xs text-muted-foreground">{message.body}</p>
              ) : (
                <Bubble message={message} mine={message.authorRole === viewerRole} />
              )}
            </div>
          ))}
          <div ref={bottom} />
        </div>

        {/* ── The composer ───────────────────────────────────────────────────
            The send button lives INSIDE the box rather than beside it, and there is no
            divider above: the field is obviously a field, and a rule across the width was
            separating it from a conversation it is part of. */}
        <div className="p-4 pt-0">
          {closed ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/30 px-4 py-3">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <CircleCheck className="size-4 text-success" />
                This ticket is closed. Replying reopens it.
              </p>
              <Button
                variant="secondary"
                size="lg"
                disabled={busyStatus}
                onClick={() => changeStatus("open")}
              >
                {busyStatus ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}
                Reopen
              </Button>
            </div>
          ) : (
            /* One line tall, growing only as they write. A tall empty box implies a long
               answer is expected, and most replies are a sentence. */
            <form
              onSubmit={send}
              className="flex items-end gap-2 rounded-xl border bg-background px-3 py-2 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50"
            >
              <textarea
                ref={input}
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                  grow(e.currentTarget);
                }}
                onKeyDown={(e) => {
                  // Enter sends, shift+enter breaks the line. Not labelled: every chat works
                  // this way and nobody needs telling.
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                maxLength={5000}
                placeholder="Write a reply"
                className="max-h-40 min-w-0 flex-1 resize-none bg-transparent py-1.5 text-sm outline-none"
              />

              {/* A round icon button. At one line tall the box is a chat input, and a
                  labelled rectangle in it reads as a form control rather than "send this". */}
              {/* size-8 exactly matches the one-line textarea's height, so a bigger button
                  does not make the box taller — the textarea still governs the row. */}
              <Button
                type="submit"
                size="icon"
                aria-label="Send"
                className="shrink-0 rounded-full"
                disabled={sending || !body.trim()}
              >
                {sending ? <LoaderCircle className="animate-spin" /> : <ArrowUp />}
              </Button>
            </form>
          )}
        </div>
      </div>

      {/* ── Details ───────────────────────────────────────────────────────── */}
      <aside className="w-full shrink-0 lg:w-72">
        <div className="rounded-xl border bg-card">
          <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Ticket details
            </h2>
            <StatusPill closed={closed} />
          </div>

          <dl className="grid grid-cols-2 gap-4 p-4">
            <Field label="Priority">
              <span className={priorityTone(initialTicket.priority)}>
                {priorityLabel(initialTicket.priority)}
              </span>
            </Field>
            <Field label="Category">{categoryLabel(initialTicket.category)}</Field>
            <Field label="Messages">
              <span className="flex items-center gap-1.5">
                <MessageSquare className="size-3.5 text-muted-foreground" />
                {messages.filter((m) => m.authorRole !== "system").length}
              </span>
            </Field>
            <Field label="Opened">{shortDate(initialTicket.createdAt)}</Field>
          </dl>

          <div className="border-t p-4">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Actions
            </h3>
            <Button
              variant="secondary"
              size="lg"
              className="w-full"
              disabled={busyStatus}
              onClick={() => changeStatus(closed ? "open" : "closed")}
            >
              {busyStatus ? (
                <LoaderCircle className="animate-spin" />
              ) : closed ? (
                <RotateCcw />
              ) : (
                <CircleCheck />
              )}
              {closed ? "Reopen ticket" : "Close ticket"}
            </Button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

function StatusPill({ closed }: { closed: boolean }) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        closed
          ? "bg-muted text-muted-foreground ring-border"
          : "bg-success/10 text-success ring-success/25"
      )}
    >
      <span className={cn("size-1.5 rounded-full", closed ? "bg-muted-foreground" : "bg-success")} />
      {closed ? "Closed" : "Open"}
    </span>
  );
}

function Bubble({ message, mine }: { message: ThreadMessage; mine: boolean }) {
  const fromSupport = message.authorRole === "admin";

  return (
    <div className={cn("flex items-end gap-2 py-1.5", mine ? "justify-end" : "justify-start")}>
      {!mine && (
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
            fromSupport ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
          )}
          aria-hidden
        >
          {fromSupport ? <ShieldCheck className="size-3.5" /> : message.authorName.charAt(0).toUpperCase()}
        </span>
      )}

      <div className={cn("max-w-[85%] sm:max-w-[75%]", mine && "text-right")}>
        <div
          className={cn(
            "mb-1 flex items-center gap-2 text-[11px] text-muted-foreground",
            mine && "justify-end"
          )}
        >
          <span className="font-medium">{message.authorName}</span>
          <span>{clock(message.createdAt)}</span>
        </div>

        <div
          className={cn(
            "inline-block whitespace-pre-wrap rounded-xl px-3.5 py-2.5 text-left text-sm",
            mine ? "bg-primary text-primary-foreground" : "border bg-muted/40"
          )}
        >
          {message.body}
        </div>
      </div>
    </div>
  );
}

/**
 * Grow the reply box to fit what's in it, up to a limit.
 *
 * Height has to be reset to auto FIRST: scrollHeight can only report content taller than the
 * current height, so measuring without resetting means the box grows and never shrinks again
 * when text is deleted.
 */
function grow(element: HTMLTextAreaElement): void {
  element.style.height = "auto";
  element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
}

/** True when this message is on a different day from the one before it. */
function needsDateSeparator(messages: ThreadMessage[], index: number): boolean {
  if (index === 0) return true;

  const previous = new Date(messages[index - 1].createdAt).toDateString();
  const current = new Date(messages[index].createdAt).toDateString();
  return previous !== current;
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86_400_000).toDateString();

  if (date.toDateString() === today) return "Today";
  if (date.toDateString() === yesterday) return "Yesterday";

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
