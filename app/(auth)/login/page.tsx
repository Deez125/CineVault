import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthForm } from "@/components/auth/auth-form";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { ForgotPasswordLink } from "./forgot-link";
import { loginAction } from "@/lib/auth/actions";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string; error?: string }>;
}) {
  const params = await searchParams;

  // Already signed in. Sending them to a sign-in form they don't need is a small thing that
  // makes a site feel broken.
  if (await getSessionUser()) redirect(params.next ?? "/dashboard");

  return (
    <>
      <div className="mb-8 text-center">
        <h1 className="auth-display text-4xl leading-none sm:text-5xl">Welcome back</h1>
        <p className="mt-3 text-sm text-muted-foreground">Sign in to your account.</p>
      </div>

      {params.reset && (
        <Alert className="mb-4">
          <CircleCheck className="text-success" />
          <AlertDescription>
            Your password has been changed. Sign in with the new one.
          </AlertDescription>
        </Alert>
      )}

      {params.error && (
        <Alert variant="destructive" className="mb-4">
          <TriangleAlert />
          <AlertDescription>
            {friendlyOAuthError(params.error)}
          </AlertDescription>
        </Alert>
      )}

      <OAuthButtons next={params.next} />

      <div className="my-6 flex items-center gap-3 text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        <span className="auth-mono">Or</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <AuthForm action={loginAction} submitLabel="Sign in" pendingLabel="Signing in">
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
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <ForgotPasswordLink />
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
      </AuthForm>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="text-foreground underline underline-offset-2">
          Create one
        </Link>
      </p>
    </>
  );
}

/**
 * Turn one of the query-param errors /auth/callback surfaces into something readable. The
 * default drops the raw message straight through so a truly novel error is still visible.
 */
function friendlyOAuthError(error: string): string {
  if (error === "missing_code") {
    return "That sign-in link was incomplete. Try again.";
  }
  if (error === "no_user") {
    return "We couldn't find your account after sign-in. Try again.";
  }
  if (/expired/i.test(error)) {
    return "That link has expired. Ask for a fresh one.";
  }
  return error;
}
