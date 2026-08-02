import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { verifyEmailToken } from "@/lib/auth/actions";

export const metadata: Metadata = { title: "Confirm your email" };

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const verified = token ? await verifyEmailToken(token) : false;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-12 text-center">
      <Link href="/" className="mb-8 flex items-center gap-2.5">
        <Image src="/logo.png" alt="" width={32} height={32} className="rounded-md" priority />
        <span className="text-lg font-semibold tracking-tight">CineVault</span>
      </Link>

      {verified ? (
        <>
          <CircleCheck className="size-10 text-success" />
          <h1 className="mt-5 text-xl font-semibold tracking-tight">Email confirmed</h1>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Thanks. That&apos;s your address verified.
          </p>
          <Button size="lg" className="mt-6" render={<Link href="/dashboard" />}>
            Go to my account
          </Button>
        </>
      ) : (
        <>
          <TriangleAlert className="size-10 text-destructive" />
          <h1 className="mt-5 text-xl font-semibold tracking-tight">That link didn&apos;t work</h1>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            It may have expired or already been used. Sign in and ask for a new one from your
            account settings.
          </p>
          <Button size="lg" className="mt-6" render={<Link href="/login" />}>
            Sign in
          </Button>
        </>
      )}
    </div>
  );
}
