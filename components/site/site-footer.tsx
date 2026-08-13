import Link from "next/link";

/**
 * The plain footer used by /help, /terms, /privacy.
 *
 * The landing page renders its OWN footer to match the design shell there; this one
 * exists so the ancillary marketing pages still have a footer without the landing's
 * dark-theme markup underneath their light content.
 */
export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-6 text-sm text-muted-foreground sm:px-6">
        <span>© {new Date().getFullYear()} CineVault</span>

        <nav className="flex flex-wrap items-center gap-5">
          <Link href="/help" className="transition-colors hover:text-foreground">
            Help
          </Link>
          <Link href="/terms" className="transition-colors hover:text-foreground">
            Terms
          </Link>
          <Link href="/privacy" className="transition-colors hover:text-foreground">
            Privacy
          </Link>
        </nav>
      </div>
    </footer>
  );
}
