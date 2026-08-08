import Link from "next/link";
import { SiteHeader } from "./site-header";
import type { SessionUser } from "@/lib/auth/session";

/** Shared shell for Terms and Privacy. Prose, one column, nothing to click but the words. */
export function LegalPage({
  user,
  title,
  updated,
  children,
}: {
  user: SessionUser | null;
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader user={user} />

      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-16">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Last updated {updated}</p>

        <div className="mt-10 space-y-8">{children}</div>

        <p className="mt-12 border-t pt-8 text-center text-sm text-muted-foreground">
          <Link href="/" className="underline underline-offset-2 hover:text-foreground">
            Back to CineVault
          </Link>
        </p>
      </main>
    </>
  );
}

export function Clause({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-semibold">{heading}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}
