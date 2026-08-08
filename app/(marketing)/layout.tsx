import Link from "next/link";

/** Shared footer for the public pages. The header is per-page, since it needs the session. */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex-1">{children}</div>

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
    </div>
  );
}
