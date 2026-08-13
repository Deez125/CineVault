import Link from "next/link";
import { Gift } from "lucide-react";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthForm } from "@/components/auth/auth-form";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { signupAction } from "@/lib/auth/actions";
import { getSessionUser } from "@/lib/auth/session";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/constants";
import { REFEREE_PERCENT_OFF, findInviter, inspectCode } from "@/lib/referrals";
import { displayName } from "@/lib/display-name";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; ref?: string }>;
}) {
  const params = await searchParams;
  if (await getSessionUser()) redirect(params.next ?? "/dashboard");

  // A dead invite gets its own page rather than being quietly ignored. Somebody who followed
  // a link expecting half off should be told it will not happen, not shown a normal signup
  // form and surprised by the full price at checkout.
  if (params.ref) {
    const state = await inspectCode(params.ref);
    if (state !== "live") redirect(`/invite-unavailable?state=${state}`);
  }

  // Looked up here purely so the page can say whose invite this is. The code itself is
  // re-checked server-side at signup; nothing trusts this render.
  const referrer = params.ref ? await findInviter(params.ref) : null;

  return (
    <>
      <div className="mb-8 text-center">
        <h1 className="auth-display text-4xl leading-none sm:text-5xl">Get started</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          You can pick a plan once you&apos;re in.
        </p>
      </div>

      {referrer && (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-success/30 bg-success/5 p-4 text-sm">
          <Gift className="mt-0.5 size-4 shrink-0 text-success" />
          <span>
            <b>{displayName(referrer)}</b> invited you. You&apos;ll get{" "}
            {REFEREE_PERCENT_OFF}% off your first month, whichever plan you pick.
          </span>
        </div>
      )}

      <OAuthButtons next={params.next} />

      <div className="my-6 flex items-center gap-3 text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        <span className="auth-mono">Or</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <AuthForm action={signupAction} submitLabel="Create account" pendingLabel="Creating account">
        {params.next && <input type="hidden" name="next" value={params.next} />}
        {params.ref && <input type="hidden" name="ref" value={params.ref} />}

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
