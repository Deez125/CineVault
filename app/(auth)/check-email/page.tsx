import Link from "next/link";
import type { Metadata } from "next";
import { Mail } from "lucide-react";

export const metadata: Metadata = { title: "Check your email" };

/**
 * Where signup lands when the address already has an account.
 *
 * Deliberately says nothing about whether an account was created. This page and a successful
 * signup have to be indistinguishable, or the form becomes a way to test which addresses are
 * registered here.
 */
export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <div className="text-center">
      <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-muted">
        <Mail className="size-5 text-muted-foreground" />
      </div>

      <h1 className="mt-5 text-xl font-semibold tracking-tight">Check your email</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {email ? (
          <>
            We&apos;ve sent a message to <span className="text-foreground">{email}</span>. Open
            it to carry on.
          </>
        ) : (
          "We've sent you a message. Open it to carry on."
        )}
      </p>

      <p className="mt-6 text-sm text-muted-foreground">
        <Link href="/login" className="text-foreground underline underline-offset-2">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
