import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { getSupabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { attachReferral } from "@/lib/referrals";
import { logError } from "@/lib/events";

/**
 * Where email-based confirmation links land.
 *
 * The email templates build a URL on OUR domain (`{{ .SiteURL }}/auth/confirm?...`) using
 * `{{ .TokenHash }}` — the hashed OTP — rather than sending people to Supabase's raw
 * `supabase.co/auth/v1/verify?...` URL. `verifyOtp` here does the actual verification and
 * writes the session cookie on our response, so the next request is signed in.
 *
 * WHY THIS EXISTS SEPARATELY FROM `/auth/callback`: OAuth (Google, etc.) uses a `code`-based
 * PKCE flow and lands in `/auth/callback`. Email flows use `token_hash` and land here. Same
 * end state, different Supabase primitive.
 *
 * Everything redirects through `env.APP_URL` rather than the incoming request host, so
 * cookies set on `localhost` are never lost to an incoming request on `0.0.0.0` or a stray
 * `127.0.0.1`.
 */

function canonicalUrl(path: string): URL {
  return new URL(path, env.APP_URL);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(url.searchParams.get("next"));

  if (!tokenHash || !type) {
    return NextResponse.redirect(canonicalUrl("/login?error=missing_token"));
  }

  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.auth.verifyOtp({
    type,
    token_hash: tokenHash,
  });

  if (error) {
    await logError("verifyOtp failed", { error: error.message, type });
    return NextResponse.redirect(
      canonicalUrl(`/login?error=${encodeURIComponent(error.message)}`)
    );
  }

  const authUser = data.user;
  if (!authUser) {
    return NextResponse.redirect(canonicalUrl("/login?error=no_user"));
  }

  // Recovery = password reset. The verifyOtp above created the recovery session; /reset's
  // updateUser call runs against it.
  if (type === "recovery") {
    return NextResponse.redirect(canonicalUrl("/reset"));
  }

  // Signup or email-confirm: apply the pending referral (idempotent — see helper), then
  // land on the requested next path or the dashboard as default.
  if (type === "signup" || type === "email") {
    await maybeApplyPendingReferral(authUser.id, authUser.email ?? undefined);
  }

  return NextResponse.redirect(canonicalUrl(next ?? "/dashboard"));
}

/**
 * Apply a pending referral once, then clear the marker on the auth user.
 *
 * Signup stores `referral_code` in Supabase's user_metadata; we read it here after email
 * confirmation (which is what completes the "someone was actually referred" event) and
 * clear the marker to prevent a later re-verification from trying to attach it again.
 *
 * Duplicated with `/auth/callback` deliberately — the two flows are separate enough that a
 * shared helper would need to import from both routes, which is a needless coupling for a
 * ~30 line function.
 */
async function maybeApplyPendingReferral(
  userId: string,
  email: string | undefined
): Promise<void> {
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
      "attachReferral from /auth/confirm failed",
      { error: err instanceof Error ? err.message : String(err), code },
      { userId }
    );
  }

  await supabaseAdmin.auth.admin.updateUserById(userId, {
    user_metadata: { ...meta, referral_code: null },
  });
}

function safeNext(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}
