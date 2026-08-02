import Link from "next/link";
import type { Metadata } from "next";
import { TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthForm } from "@/components/auth/auth-form";
import { resetPasswordAction } from "@/lib/auth/actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";

export const metadata: Metadata = { title: "Set a new password" };

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <>
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>
            This link is missing its token. Ask for a new reset email.
          </AlertDescription>
        </Alert>
        <p className="mt-6 text-center text-sm">
          <Link href="/forgot" className="underline underline-offset-2">
            Request a new link
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <div className="mb-6 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Set a new password</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          You&apos;ll be signed out everywhere else.
        </p>
      </div>

      <AuthForm
        action={resetPasswordAction}
        submitLabel="Change password"
        pendingLabel="Changing password"
      >
        {/* The token rides in the form rather than being read from the URL client-side, so it
            is never exposed to anything running in the page. */}
        <input type="hidden" name="token" value={token} />

        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            autoFocus
            minLength={MIN_PASSWORD_LENGTH}
          />
          <p className="text-xs text-muted-foreground">
            At least {MIN_PASSWORD_LENGTH} characters.
          </p>
        </div>
      </AuthForm>
    </>
  );
}
