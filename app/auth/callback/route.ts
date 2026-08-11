import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getSupabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { attachReferral } from "@/lib/referrals";
import { logError } from "@/lib/events";
import { env } from "@/lib/env";

/**
 * Every redirect out of this route pins to the canonical APP_URL, not to the host on the
 * incoming request. If the browser reached us on 0.0.0.0 or 127.0.0.1 while APP_URL points to
 * localhost, cookies set on one host are not sent to the other and the visitor lands
 * "signed in" without a session. Anchoring every redirect on APP_URL makes host drift
 * impossible.
 */
function canonicalUrl(path: string): URL {
  return new URL(path, env.APP_URL);
}

/**
 * Where Supabase Auth sends every visitor after it does its thing.
 *
 * Three flows converge here:
 *
 *   - **Email confirmation.** The link in a signup or resend email hits Supabase, which
 *     verifies the token internally and redirects here with a `code`.
 *   - **OAuth completion.** After Google (or any other provider) approves, Supabase redirects
 *     back with a `code`.
 *   - **Password reset.** The link in a reset email lands here first, exchanges the code for
 *     a short-lived recovery session, then hands off to `/reset`.
 *
 * Every path calls `exchangeCodeForSession`, which is Supabase's write-cookies primitive — it
 * puts the auth cookie on THIS response, so the next request lands signed in.
 *
 * `next` is a same-site path we came from, preserved through the flow. `type=recovery` is set
 * by Supabase itself when the visitor is coming through a password reset link — we detect it
 * to route them at `/reset` instead of the dashboard.
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = safeNext(requestUrl.searchParams.get("next"));
  const errorParam = requestUrl.searchParams.get("error_description");

  // Supabase sometimes surfaces its own errors as query params rather than a body — a stale
  // link, a rate-limited exchange. Show them a clean message rather than dropping them at a
  // page that says "sign in" as if nothing had happened.
  if (errorParam) {
    return NextResponse.redirect(
      canonicalUrl(`/login?error=${encodeURIComponent(errorParam)}`)
    );
  }

  if (!code) {
    return NextResponse.redirect(canonicalUrl("/login?error=missing_code"));
  }

  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    await logError("auth callback exchangeCodeForSession failed", { error: error.message });
    return NextResponse.redirect(canonicalUrl(`/login?error=${encodeURIComponent(error.message)}`));
  }

  const authUser = data.user;
  if (!authUser) {
    return NextResponse.redirect(canonicalUrl("/login?error=no_user"));
  }

  // Password-reset links land here with next=/reset. The exchange above already put a
  // recovery session on the response; /reset's updateUser call runs against it.
  if (next === "/reset") {
    return NextResponse.redirect(canonicalUrl("/reset"));
  }

  // First time this account has confirmed? Apply the pending referral, if any. The trigger
  // already inserted the profile row when auth.users was created, so we're updating an
  // existing row — never inserting.
  await maybeApplyPendingReferral(authUser.id, authUser.email);

  return NextResponse.redirect(canonicalUrl(next ?? "/dashboard"));
}

/**
 * Apply a pending referral once, then clear the marker.
 *
 * Signup stores `referral_code` in Supabase's user_metadata; we read it here after the email
 * is confirmed (which is what completes the "someone was actually referred" event). Clearing
 * it via the admin API prevents a second confirmation — say a stale link opened later — from
 * trying to attach the same code a second time.
 */
async function maybeApplyPendingReferral(
  userId: string,
  email: string | undefined
): Promise<void> {
  // Read metadata directly rather than from `authUser.user_metadata` on the caller side —
  // getUser returns whatever the SDK cached, and we want the CURRENT server value here.
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (error || !data.user) return;

  const meta = (data.user.user_metadata ?? {}) as { referral_code?: string };
  const code = meta.referral_code;
  if (!code) return;

  const [profile] = await db
    .select({ id: users.id, email: users.email, referredBy: users.referredBy })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  // Already attributed — the code was applied on a prior confirmation. Idempotent.
  if (!profile || profile.referredBy) {
    await supabaseAdmin.auth.admin.updateUserById(userId, {
      user_metadata: { ...meta, referral_code: null },
    });
    return;
  }

  try {
    await attachReferral({ id: userId, email: profile.email ?? email ?? "" }, code);
  } catch (err) {
    await logError(
      "attachReferral from /auth/callback failed",
      { error: err instanceof Error ? err.message : String(err), code },
      { userId }
    );
  }

  // Whether attach succeeded or not, clear the marker — a stale invite code is not worth
  // trying twice, and leaving it around means every subsequent OAuth sign-in re-runs this.
  await supabaseAdmin.auth.admin.updateUserById(userId, {
    user_metadata: { ...meta, referral_code: null },
  });
}

function safeNext(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}
