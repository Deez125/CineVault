import Link from "next/link";
import type { Metadata } from "next";
import { TicketX } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Invite no longer available" };

/**
 * Where a dead invite link lands.
 *
 * The important part is what this page does NOT do: every way off it goes to a plain
 * /signup with no `ref` on it. Signing up from here is an ordinary signup — no half-price
 * month for the visitor, no credit for whoever sent the link. A dead invite is dead, and the
 * only route back to the discount is a fresh link from the person who invited them.
 */
export default async function InviteUnavailablePage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;

  const used = state === "used";

  return (
    <div className="text-center">
      <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-muted">
        <TicketX className="size-5 text-muted-foreground" />
      </div>

      <h1 className="mt-5 text-xl font-semibold tracking-tight">
        {used ? "This invite has been used" : "This invite no longer works"}
      </h1>

      <p className="mt-2 text-sm text-muted-foreground">
        {used
          ? "Invite links work for one person, and somebody has already signed up with this one."
          : "Invite links last 30 days, and this one has run out — or the person who sent it has since cancelled it."}
      </p>

      <p className="mt-4 text-sm text-muted-foreground">
        Ask whoever sent it for a new link and the discount still applies. You can also create
        an account without one.
      </p>

      <div className="mt-6 flex flex-col gap-2">
        {/* Plain /signup. No ref, so nobody gets the referral benefit from this route. */}
        <Button render={<Link href="/signup" />}>Create an account anyway</Button>

        <Button variant="ghost" render={<Link href="/login" />}>
          I already have an account
        </Button>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Signing up from here won&apos;t include the referral discount.
      </p>
    </div>
  );
}
