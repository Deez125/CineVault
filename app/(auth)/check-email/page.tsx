import Link from "next/link";
import type { Metadata } from "next";
import { Mailbox } from "lucide-react";
import { ResendLink } from "./resend";

export const metadata: Metadata = { title: "Check your email" };

/**
 * Where signup lands.
 *
 * With verification on, NO account exists yet — the address is sitting in `pending_signups`
 * and becomes an account only when the emailed link is opened. So this is not a courtesy
 * screen at the end of a flow, it is the middle of one, and it has to offer a way forward
 * when the message does not arrive.
 *
 * It still says nothing about whether the address was already registered. A stranger and the
 * real owner both see exactly this page; only the message that lands differs, and only the
 * owner can read that.
 */
export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <div className="text-center">
      {/* No circle behind it. The icon is an illustration, and a filled disc reads as a
          button somebody is meant to press. */}
      <Mailbox className="mx-auto size-10 text-muted-foreground" strokeWidth={1.5} />

      <h1 className="mt-5 text-xl font-semibold tracking-tight">Check your email</h1>

      <p className="mt-2 text-sm text-muted-foreground">
        {email ? (
          <>
            We&apos;ve sent a confirmation link to{" "}
            <span className="font-medium text-foreground">{email}</span>. Open it to finish
            creating your account.
          </>
        ) : (
          "We've sent you a confirmation link. Open it to finish creating your account."
        )}
      </p>

      <p className="mt-3 text-xs text-muted-foreground">
        The link expires in 24 hours. Until you open it, no account exists.
      </p>

      {email && <ResendLink email={email} />}

      <p className="mt-8 text-sm text-muted-foreground">
        <Link href="/login" className="text-foreground underline underline-offset-2">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
