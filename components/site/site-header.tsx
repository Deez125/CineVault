import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import type { SessionUser } from "@/lib/auth/session";

/**
 * The public site's header. The signed-in app has its own shell with a sidebar; this one is
 * only ever seen by visitors and by members passing through the marketing pages.
 */
export function SiteHeader({ user }: { user: SessionUser | null }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
      {/* Tighter gutters below `sm` only. The row is brand + toggle + two buttons; with the
          previous separate wordmark + circular icon it overflowed on a 375px phone at the
          default gutters. Everything from `sm` up is untouched. */}
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 sm:gap-4 sm:px-6">
        <Link href="/" className="flex items-center" aria-label="CineVault">
          {/* SVG wordmark: the "CineVault" text is part of the mark, so the old separate
              text span is gone. */}
          <Image
            src="/logo.svg"
            alt="CineVault"
            width={120}
            height={28}
            className="h-7 w-auto invert dark:invert-0"
            priority
          />
        </Link>

        <div className="flex items-center gap-1.5">
          <ThemeToggle />

          {/* Base UI composes with `render`, not `asChild`. The rendered element receives the
              button's classes and props, so this really is an <a>, not a button that
              navigates with JavaScript. */}
          {user ? (
            <Button size="lg" render={<Link href="/dashboard" />}>
              My account
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="lg" render={<Link href="/login" />}>
                Sign in
              </Button>
              <Button size="lg" render={<Link href="/signup" />}>
                Get started
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
