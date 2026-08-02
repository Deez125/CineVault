"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, LoaderCircle, RotateCcw, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ThreadMessage = {
  id: number;
  authorRole: string;
  authorName: string;
  body: string;
  createdAt: string;
};

/**
 * A live support conversation.
 *
 * While the ticket is OPEN this polls for new messages every few seconds, so a reply lands
 * without anybody being told to refresh. When the ticket is closed the polling stops — there
 * is nothing more coming, and a closed ticket left polling forever is a request every three
 * seconds per open tab, for nothing.
 *
 * It also stops while the tab is hidden. A backgrounded tab cannot show anybody anything, and
 * browsers throttle its timers unpredictably anyway; on return it catches up in one request
 * because the cursor is a message id rather than a clock.
 */
export function TicketThread({
  ticketId,
  initialMessages,
  initialStatus,
  viewerRole,
  canClose = true,
}: {
  ticketId: string;
  initialMessages: ThreadMessage[];
  initialStatus: string;
  /** Which side is reading. Only decides which bubbles sit on the right. */
  viewerRole: "user" | "admin";
  canClose?: boolean;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages);
  const [status, setStatus] = useState(initialStatus);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [busyStatus, setBusyStatus] = useState(false);

  const bottom = useRef<HTMLDivElement>(null);
  // Read inside the poll without making it a dependency, which would tear down and rebuild
  // the interval on every single message.
  const lastId = useRef(initialMessages.at(-1)?.id ?? 0);

  const merge = useCallback((incoming: ThreadMessage[]) => {
    if (incoming.length === 0) return;

    setMessages((current) => {
      // The sender already added their own message optimistically, and the poll will hand it
      // back a moment later. Deduping by id is what stops it appearing twice.
      const seen = new Set(current.map((m) => m.id));
      const fresh = incoming.filter((m) => !seen.has(m.id));
      if (fresh.length === 0) return current;

      return [...current, ...fresh].sort((a, b) => a.id - b.id);
    });

    const highest = incoming.at(-1)?.id ?? 0;
    if (highest > lastId.current) lastId.current = highest;
  }, []);

  // ── The live loop ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (status !== "open") return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (stopped || document.hidden) return schedule();

      try {
        const res = await fetch(
          `/api/tickets/${ticketId}/messages?since=${lastId.current}`,
          { cache: "no-store" }
        );

        if (res.ok) {
          const data = await res.json();
          merge(data.messages ?? []);
          if (data.status && data.status !== status) setStatus(data.status);
        }
      } catch {
        // A blip is not the end of the conversation. Try again on the next tick.
      }

      schedule();
    };

    const schedule = () => {
      if (!stopped) timer = setTimeout(poll, 3000);
    };

    // Coming back to the tab should feel immediate rather than waiting out a tick.
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
  }, [ticketId, status, merge]);

  // Follow the conversation as it grows.
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const text = body.trim();
    if (!text || sending) return;

    setSending(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't send that.");

      setBody("");
      merge([data.message]);
      // Replying reopens a closed ticket, so reflect that rather than leaving the UI saying
      // closed while the server disagrees.
      if (status !== "open") setStatus("open");
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
      const res = await fetch(`/api/tickets/${ticketId}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "That didn't work.");

      setStatus(next);
      // The status change writes a note into the thread; pick it up straight away rather
      // than waiting for a poll that has just been switched off.
      const fresh = await fetch(`/api/tickets/${ticketId}/messages?since=${lastId.current}`);
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
    <div className="flex min-h-0 flex-1 flex-col rounded-xl border bg-card">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        {messages.map((message) =>
          message.authorRole === "system" ? (
            <p
              key={message.id}
              className="text-center text-xs text-muted-foreground"
            >
              {message.body} · {time(message.createdAt)}
            </p>
          ) : (
            <Bubble key={message.id} message={message} mine={message.authorRole === viewerRole} />
          )
        )}
        <div ref={bottom} />
      </div>

      <div className="border-t p-4">
        {closed ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
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
        ) : null}

        <form onSubmit={send} className={cn("flex gap-2", closed && "mt-3")}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, shift+enter breaks the line. Matches every chat anybody has
              // used, and a support reply is a chat message, not an essay.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(e as unknown as React.FormEvent);
              }
            }}
            rows={2}
            maxLength={5000}
            placeholder={closed ? "Reply to reopen this ticket" : "Write a reply"}
            className="min-h-[2.75rem] flex-1 resize-y rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <Button type="submit" size="lg" disabled={sending || !body.trim()}>
            {sending ? <LoaderCircle className="animate-spin" /> : <Send />}
            Send
          </Button>
        </form>

        {canClose && !closed && (
          <button
            onClick={() => changeStatus("closed")}
            disabled={busyStatus}
            className="mt-3 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            Close this ticket
          </button>
        )}
      </div>
    </div>
  );
}

function Bubble({ message, mine }: { message: ThreadMessage; mine: boolean }) {
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[85%] sm:max-w-[70%]", mine && "text-right")}>
        <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
          {mine ? (
            <>
              <span>{time(message.createdAt)}</span>
              <span className="font-medium">{message.authorName}</span>
            </>
          ) : (
            <>
              <span className="font-medium">{message.authorName}</span>
              <span>{time(message.createdAt)}</span>
            </>
          )}
        </div>

        <div
          className={cn(
            "inline-block whitespace-pre-wrap rounded-xl px-3.5 py-2.5 text-left text-sm",
            mine
              ? "bg-primary text-primary-foreground"
              : "border bg-muted/40"
          )}
        >
          {message.body}
        </div>
      </div>
    </div>
  );
}

function time(iso: string): string {
  const date = new Date(iso);
  const sameDay = new Date().toDateString() === date.toDateString();

  return sameDay
    ? date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}
