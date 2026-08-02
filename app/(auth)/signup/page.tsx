import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthForm } from "@/components/auth/auth-form";
import { signupAction } from "@/lib/auth/actions";
import { getSessionUser } from "@/lib/auth/session";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/constants";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  if (await getSessionUser()) redirect(params.next ?? "/dashboard");

  return (
    <>
      <div className="mb-6 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Create your account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          You can pick a plan once you&apos;re in.
        </p>
      </div>

      <AuthForm action={signupAction} submitLabel="Create account" pendingLabel="Creating account">
        {params.next && <input type="hidden" name="next" value={params.next} />}

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            placeholder="you@example.com"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
          />
          <p className="text-xs text-muted-foreground">
            At least {MIN_PASSWORD_LENGTH} characters.
          </p>
        </div>
      </AuthForm>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="text-foreground underline underline-offset-2">
          Sign in
        </Link>
      </p>

      <p className="mt-4 text-center text-xs text-muted-foreground">
        By creating an account you agree to our{" "}
        <Link href="/terms" className="underline underline-offset-2">
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="underline underline-offset-2">
          Privacy Policy
        </Link>
        .
      </p>
    </>
  );
}
