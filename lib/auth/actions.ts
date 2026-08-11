"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { env } from "@/lib/env";
import { logEvent } from "@/lib/events";
import { rateLimit, resetRateLimit } from "@/lib/rate-limit";
import { getSupabaseServer } from "@/lib/supabase/server";

/**
 * Sign up, sign in, sign out, and password reset.
 *
 * Identity is Supabase's now. These actions are thin wrappers that shape a Zod-validated
 * form into a Supabase call and translate Supabase's specific error codes into the
 * user-facing messages this app has always shown.
 *
 * Two principles run through all of it, unchanged from before:
 *
 *   1. **Never confirm whether an email has an account.** Signup and forgot-password answer
 *      the same regardless of whether the address is known. Supabase's default behaviour is
 *      to leak this via the error message on signup — we normalise it below.
 *
 *   2. **Sign-in failures are one message.** "No such user" and "wrong password" are the
 *      same sentence, because the difference between them is exactly what an attacker wants.
 *      Supabase collapses these itself; we make sure we don't accidentally distinguish them.
 */

export type FormState = { error?: string; success?: string } | null;

const MIN_PASSWORD_LENGTH = 8;

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Enter your email address.")
  .max(254)
  .email("That doesn't look like an email address.");

const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
  .max(200, "That password is too long.");

// ═══════════════════════════════════════════════════════════════════════════════
// Sign up
// ═══════════════════════════════════════════════════════════════════════════════

export async function signupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = z
    .object({ email: emailSchema, password: passwordSchema })
    .safeParse({ email: formData.get("email"), password: formData.get("password") });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const { email, password } = parsed.data;
  const next = asSafePath(formData.get("next"));
  const ip = await clientIp();
  const ref = referralCodeFrom(formData.get("ref"));

  const limit = rateLimit(`signup:${ip}`, 5, 60 * 60 * 1000);
  if (!limit.allowed) {
    return { error: "Too many accounts from this connection. Try again later." };
  }

  const supabase = await getSupabaseServer();

  // `emailRedirectTo` is where Supabase sends the visitor after they click the confirm link.
  // That URL must be listed in the Supabase dashboard under Auth → URL Configuration → Redirect
  // URLs, otherwise the click 404s. `next` piggybacks through the callback so we land back on
  // the page they came from.
  const redirectUrl = new URL("/auth/callback", env.APP_URL);
  if (next) redirectUrl.searchParams.set("next", next);

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Referral code goes in `raw_user_meta_data` on the auth user, applied in the callback
      // once the address is confirmed. Storing the CODE (not the referrer's id) preserves the
      // single-use-link semantics — a code can only be claimed once, and the reader has to
      // race for it in attachReferral.
      data: ref ? { referral_code: ref } : undefined,
      emailRedirectTo: redirectUrl.toString(),
    },
  });

  // Supabase returns { data: { user: null }, error: null } for the "email already registered"
  // case when confirm-email is on. Which is exactly the enumeration protection we want: the
  // form's answer for a known email and an unknown one is identical — "check your inbox".
  if (error) {
    // The specific "already registered" shape can still leak on some Supabase configurations;
    // fold it into the neutral response below just in case. All other errors surface.
    if (error.status === 422 || /already/i.test(error.message)) {
      redirect(`/check-email?email=${encodeURIComponent(email)}`);
    }
    return { error: friendlyAuthError(error.message) };
  }

  redirect(`/check-email?email=${encodeURIComponent(email)}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sign in
// ═══════════════════════════════════════════════════════════════════════════════

const BAD_CREDENTIALS = "That email and password don't match.";

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = z
    .object({ email: emailSchema, password: z.string().min(1, "Enter your password.") })
    .safeParse({ email: formData.get("email"), password: formData.get("password") });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? BAD_CREDENTIALS };
  }

  const { email, password } = parsed.data;
  const next = asSafePath(formData.get("next"));

  // Rate limits ON TOP OF Supabase's own. Ours are per-account and per-connection: per-account
  // alone lets an attacker lock out a real customer by guessing at their address; per-connection
  // alone lets a botnet spread the guesses across many addresses. Both together bound the game
  // in both directions.
  const ip = await clientIp();
  const byAccount = rateLimit(`login:acct:${email}`, 10, 15 * 60 * 1000);
  const byIp = rateLimit(`login:ip:${ip}`, 30, 15 * 60 * 1000);

  if (!byAccount.allowed || !byIp.allowed) {
    return { error: "Too many attempts. Wait a few minutes and try again." };
  }

  const supabase = await getSupabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Supabase's ban feature (admin.updateUserById with ban_duration) makes signIn fail with
    // this specific message. We surface it plainly — a paying customer suddenly locked out
    // deserves to know the reason isn't a typo.
    if (/banned|blocked/i.test(error.message) || error.status === 403) {
      return { error: "This account has been banned. Contact support if you think that's a mistake." };
    }
    return { error: BAD_CREDENTIALS };
  }

  resetRateLimit(`login:acct:${email}`);

  redirect(next ?? "/dashboard");
}

export async function logoutAction(): Promise<void> {
  const supabase = await getSupabaseServer();
  await supabase.auth.signOut();
  redirect("/");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Password reset
// ═══════════════════════════════════════════════════════════════════════════════

export async function requestResetAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const parsed = emailSchema.safeParse(formData.get("email"));

  // Even a malformed address gets the neutral answer so the form never becomes an
  // enumeration oracle.
  const neutral: FormState = {
    success: "If that address has an account, a reset link is on its way.",
  };

  if (!parsed.success) return neutral;
  const email = parsed.data;

  const limit = rateLimit(`reset:${email}`, 20, 60 * 60 * 1000);
  if (!limit.allowed) return neutral;

  const supabase = await getSupabaseServer();

  // Route the reset link through /auth/callback (which knows how to exchange the PKCE code
  // for a session) with next=/reset. Pointing straight at /reset skipped that exchange —
  // the visitor arrived with a code but no live session, so the page's getUser() returned
  // null and rendered the "expired link" screen for a perfectly good link.
  const callback = new URL("/auth/callback", env.APP_URL);
  callback.searchParams.set("next", "/reset");

  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: callback.toString(),
  });

  return neutral;
}

/**
 * Set a new password, on a page reached through the reset link.
 *
 * Supabase's recovery link lands the visitor on `/reset` with a short-lived session that only
 * permits `updateUser({ password })`. The action runs against that session — there is no
 * separate "token" to redeem here as in the previous build, because Supabase burned the token
 * on the way in.
 */
export async function resetPasswordAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const parsed = passwordSchema.safeParse(formData.get("password"));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const supabase = await getSupabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "That link has expired or has already been used. Ask for a new one." };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error) return { error: friendlyAuthError(error.message) };

  // The password change already invalidated other refresh tokens via Supabase; sign this
  // session out too so the visitor arrives at the login page with a clean slate and a
  // password they just chose.
  await supabase.auth.signOut();

  await logEvent({
    type: "admin_action",
    userId: user.id,
    email: user.email ?? undefined,
    actor: "user",
    message: "password was reset",
  });

  redirect("/login?reset=1");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Verification-email resend (shown on /check-email)
// ═══════════════════════════════════════════════════════════════════════════════

export async function resendSignupAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  const same: FormState = { success: "Sent. Check your inbox, including spam." };

  if (!parsed.success) return same;
  const email = parsed.data;

  if (!rateLimit(`resend-signup:${email}`, 20, 15 * 60 * 1000).allowed) {
    return {
      error: "We've sent a few already. Check your spam folder, then try again shortly.",
    };
  }

  const supabase = await getSupabaseServer();
  const redirectUrl = new URL("/auth/callback", env.APP_URL).toString();

  // The neutral answer applies whether the address exists or not. Supabase does not error
  // on a resend for a nonexistent address, so this works out of the box.
  await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: redirectUrl },
  });

  return same;
}

/**
 * Resend the confirmation email for an already-signed-in-but-unverified user. Kept for
 * parity with the previous build's UX, though under Supabase the /check-email screen is
 * usually reached BEFORE signing in.
 */
export async function resendVerificationAction(): Promise<FormState> {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Sign in first." };
  if (user.email_confirmed_at) return { success: "Your email is already confirmed." };

  const limit = rateLimit(`verify:${user.id}`, 20, 60 * 60 * 1000);
  if (!limit.allowed) {
    return {
      error: "We've sent a few already. Check your spam folder, then try again later.",
    };
  }

  await supabase.auth.resend({
    type: "signup",
    email: user.email!,
    options: { emailRedirectTo: new URL("/auth/callback", env.APP_URL).toString() },
  });

  return { success: "Sent. Check your inbox." };
}

// ═══════════════════════════════════════════════════════════════════════════════

async function clientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip")?.trim() ?? "unknown"
  );
}

/**
 * A `next=` parameter that is safe to redirect to.
 *
 * Must be a path on this site. Accepting an absolute URL here is a classic open redirect: an
 * attacker sends `/login?next=https://evil.example`, the victim signs in for real, and lands
 * on a convincing copy of this site that harvests their password.
 */
function asSafePath(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

function referralCodeFrom(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Translate a Supabase auth-error message into something a member should read.
 *
 * Falls through to the raw message rather than a generic string, so a truly novel error
 * still surfaces in the UI — we just want to avoid the ones whose default wording is either
 * an implementation detail ("row not found") or an enumeration leak.
 */
function friendlyAuthError(message: string): string {
  if (/rate/i.test(message)) return "Too many attempts. Wait a few minutes and try again.";
  if (/network|fetch/i.test(message)) {
    return "Couldn't reach the sign-in service. Try again in a moment.";
  }
  return message;
}
