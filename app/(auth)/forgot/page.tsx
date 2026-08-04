import Link from "next/link";
import type { Metadata } from "next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthForm } from "@/components/auth/auth-form";
import { requestResetAction } from "@/lib/auth/actions";

export const metadata: Metadata = { title: "Reset your password" };

export default async function ForgotPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  // Carried over from the sign-in form, so nobody types their address twice. Prefilling from
  // a URL reveals nothing: it is the address they just typed, on their own screen.
  const { email } = await searchParams;
  const prefill = email && email.length <= 320 ? email : "";

  return (
    <>
      <div className="mb-6 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Forgot your password?</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          We&apos;ll send you a link to set a new one.
        </p>
      </div>

      <AuthForm action={requestResetAction} submitLabel="Send reset link" pendingLabel="Sending">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            defaultValue={prefill}
            placeholder="you@example.com"
          />
        </div>
      </AuthForm>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link href="/login" className="text-foreground underline underline-offset-2">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
