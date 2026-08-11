import Link from "next/link";
import type { Metadata } from "next";
import { TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthForm } from "@/components/auth/auth-form";
import { resetPasswordAction } from "@/lib/auth/actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/constants";
import { getSupabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Set a new password" };

/**
 * Land here after clicking the password-reset link.
 *
 * Under Supabase Auth the exchange has already happened at `/auth/callback`, which stashed a
 * short-lived recovery session on the request and forwarded here. That session is what
 * `updateUser({ password })` runs against. If someone opens this page WITHOUT a live
 * recovery session — a stale bookmark, refreshing hours later, a scanner following the link
 * — there is no session to update, so we show the same "ask for a fresh link" screen.
 */
export default async function ResetPage() {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <>
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>
            This link has expired, has already been used, or was replaced by a newer one. Ask
            for a fresh reset email.
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
