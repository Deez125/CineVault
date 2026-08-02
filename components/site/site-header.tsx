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
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <Image
            src="/logo.png"
            alt=""
            width={28}
            height={28}
            className="rounded-md"
            priority
          />
          <span className="text-base font-semibold tracking-tight">CineVault</span>
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
