import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "That link didn't work" };

/**
 * Where a dead confirmation link lands.
 *
 * Deliberately vague about *why*. Expired, already used, and never existed are the same
 * message, because telling them apart would let somebody probe which addresses are mid-signup.
 *
 * The way out is signing up again rather than "ask for a new link from your settings": under
 * the verify-first flow there is no account to sign into yet, so settings do not exist. Signing
 * up with the same address simply replaces the pending row and sends a fresh link.
 */
export default function VerifyExpiredPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-12 text-center">
      <Link href="/" className="mb-8 flex items-center" aria-label="CineVault">
        <Image
          src="/logo.svg"
          alt="CineVault"
          width={140}
          height={32}
          priority
          className="h-8 w-auto invert dark:invert-0"
        />
      </Link>

      <TriangleAlert className="size-10 text-destructive" />
      <h1 className="mt-5 text-xl font-semibold tracking-tight">That link didn&apos;t work</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        It may have expired, or it may already have been used. Signing up again with the same
        address will send you a fresh link.
      </p>

      <Button size="lg" className="mt-6" render={<Link href="/signup" />}>
        Sign up
      </Button>

      <p className="mt-8 text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="text-foreground underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </div>
  );
}
