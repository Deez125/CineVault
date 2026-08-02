"use client";

import { useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * The invite link, and the two ways people actually send one.
 *
 * The link is shown in full rather than hidden behind a "Copy" button. People want to see what
 * they are about to paste into a group chat, and a bare code is easier to read aloud than a
 * URL — so both are on screen.
 */
export function ReferralLink({ code, url }: { code: string; url: string }) {
  const [copied, setCopied] = useState<"link" | "code" | null>(null);

  async function copy(what: "link" | "code", text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied((c) => (c === what ? null : c)), 2000);
    } catch {
      // Clipboard access can be refused — an insecure origin, a locked-down browser. The text
      // is on screen either way, so say so rather than failing silently.
      toast.error("Couldn't copy. Select the link and copy it manually.");
    }
  }

  /** Web Share where it exists (phones, mostly), which is where people actually forward links. */
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="text-sm font-medium">Your invite link</div>
      <p className="mt-0.5 text-sm text-muted-foreground">
        Anyone who signs up through this gets their first month half price.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border bg-muted/40 px-3 py-2 font-mono text-sm">
          {url}
        </code>

        <Button onClick={() => copy("link", url)} className="shrink-0">
          {copied === "link" ? <Check /> : <Copy />}
          {copied === "link" ? "Copied" : "Copy"}
        </Button>

        {canShare && (
          <Button
            variant="outline"
            className="shrink-0"
            onClick={() =>
              navigator
                .share({
                  title: "CineVault",
                  text: "Here's 50% off your first month of CineVault.",
                  url,
                })
                .catch(() => {
                  // Dismissing the share sheet rejects. That is not an error.
                })
            }
          >
            <Share2 />
            Share
          </Button>
        )}
      </div>

      <button
        type="button"
        onClick={() => copy("code", code)}
        className="mt-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        Or give them the code:{" "}
        <span className="font-mono font-semibold tracking-widest text-foreground">{code}</span>
        {copied === "code" && <span className="ml-2 text-success">copied</span>}
      </button>
    </div>
  );
}
