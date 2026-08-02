"use server";

import crypto from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { emailTokens, users } from "@/lib/db/schema";
import { adminEmails } from "@/lib/env";
import { logEvent } from "@/lib/events";
import {
  emailVerificationRequired,
  passwordResetEmail,
  sendEmail,
  verificationEmail,
} from "@/lib/email";
import { rateLimit, resetRateLimit } from "@/lib/rate-limit";
import {
  MIN_PASSWORD_LENGTH,
  fakeVerify,
  hashPassword,
  needsRehash,
  verifyPassword,
} from "./password";
import { createSession, destroyAllSessions, destroySession, getSessionUser } from "./session";

/**
 * Sign up, sign in, sign out, and password reset.
 *
 * Two principles run through all of it:
 *
 *   1. **Never confirm whether an email has an account.** Sign-in, signup, and the reset form
 *      all answer the same way whether or not the address is known. Which email addresses
 *      hold a paid Plex subscription is not a list we should hand out to anyone who asks.
 *
 *   2. **Sign-in failures are one message.** "No such user" and "wrong password" are the same
 *      sentence, and both take about the same time (see fakeVerify), because the difference
 *      between them is exactly the information an attacker wants.
 */

export type FormState = { error?: string; success?: string } | null;

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
    .object({
      email: emailSchema,
      password: passwordSchema,
      name: z.string().trim().max(80).optional(),
    })
    .safeParse({
      email: formData.get("email"),
      password: formData.get("password"),
      name: formData.get("name") || undefined,
    });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const { email, password, name } = parsed.data;
  const next = asSafePath(formData.get("next"));
  const ip = await clientIp();

  const limit = rateLimit(`signup:${ip}`, 5, 60 * 60 * 1000);
  if (!limit.allowed) {
    return { error: "Too many accounts from this connection. Try again later." };
  }

  const passwordHash = await hashPassword(password);

  // Admin status comes from the ADMIN_EMAILS allowlist and nothing else. It is never
  // something a form can ask for.
  const isAdmin = adminEmails().includes(email);

  let userId: string;

  try {
    const [created] = await db
      .insert(users)
      .values({ email, passwordHash, name: name || null, isAdmin })
      .returning({ id: users.id });
    userId = created.id;
  } catch (err) {
    if (isUniqueViolation(err)) return duplicateSignup(email);
    throw err;
  }

  await logEvent({
    type: "account_created",
    userId,
    email,
    actor: "user",
    message: `${email} created an account`,
  });

  if (emailVerificationRequired()) {
    await issueVerificationEmail(userId, email);
  }

  await createSession(userId, { ip, userAgent: await clientUserAgent() });

  redirect(next ?? "/dashboard");
}

/**
 * Somebody tried to sign up with an address that already has an account.
 *
 * What we say depends on whether verification is on, and the difference is not cosmetic.
 *
 * WITH verification, both outcomes look identical — "check your email" — and the owner of the
 * address gets a message explaining. The form tells a stranger nothing.
 *
 * WITHOUT it, that disguise cannot work. A successful signup signs you straight in, so
 * ANYTHING else is already a signal that the address is taken; a fake "check your email"
 * would leak exactly as much while also stranding the real owner on a page waiting for a
 * message that will never arrive. So we say it plainly and point at the way forward.
 *
 * The honest summary: with no mail provider, this form can be used to test whether an address
 * has an account here. That is the cost of removing verification, it is bounded by the signup
 * rate limit, and it goes away when sending is wired up.
 */
async function duplicateSignup(email: string): Promise<FormState> {
  if (!emailVerificationRequired()) {
    return {
      error: "An account already exists with that email. Sign in instead, or reset your password.",
    };
  }

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing) {
    await sendEmail({
      to: email,
      subject: "You already have a CineVault account",
      text: [
        "Someone tried to sign up with this email address, but an account already exists.",
        "",
        "If that was you, sign in instead. If you've forgotten your password, use the",
        "'Forgot password' link on the sign-in page.",
        "",
        "If it wasn't you, nothing has changed and you can ignore this.",
      ].join("\n"),
    });
  }

  redirect(`/check-email?email=${encodeURIComponent(email)}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sign in
// ═══════════════════════════════════════════════════════════════════════════════

/** One message for every failure. See principle 2 above. */
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

  // Limited per account AND per connection. Per-account alone lets an attacker lock out a
  // real customer by guessing at their address; per-connection alone lets a botnet spread the
  // guessing across many addresses and never trip either.
  const ip = await clientIp();
  const byAccount = rateLimit(`login:acct:${email}`, 10, 15 * 60 * 1000);
  const byIp = rateLimit(`login:ip:${ip}`, 30, 15 * 60 * 1000);

  if (!byAccount.allowed || !byIp.allowed) {
    return { error: "Too many attempts. Wait a few minutes and try again." };
  }

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (!user) {
    await fakeVerify();
    return { error: BAD_CREDENTIALS };
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    return { error: BAD_CREDENTIALS };
  }

  // Opportunistic upgrade when the cost parameters have been raised since they last signed
  // in. This is the only moment we hold the plaintext, so it is the only moment it can
  // happen without asking them to reset.
  if (needsRehash(user.passwordHash)) {
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(password), updatedAt: new Date() })
      .where(eq(users.id, user.id));
  }

  resetRateLimit(`login:acct:${email}`);

  // A banned account still gets a session. requireUser() sends them to a page that explains
  // what happened, which is better than rejecting a password they know is correct and
  // leaving them to guess why.
  await createSession(user.id, { ip, userAgent: await clientUserAgent() });

  redirect(next ?? "/dashboard");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Password reset
// ═══════════════════════════════════════════════════════════════════════════════

export async function requestResetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = emailSchema.safeParse(formData.get("email"));

  // Even a malformed address gets the neutral answer, so the form never becomes a way to
  // check whether an address is registered.
  const neutral: FormState = {
    success: "If that address has an account, a reset link is on its way.",
  };

  if (!parsed.success) return neutral;

  const email = parsed.data;

  const limit = rateLimit(`reset:${email}`, 3, 60 * 60 * 1000);
  if (!limit.allowed) return neutral;

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (user) {
    const token = await issueToken(user.id, "reset_password", 60 * 60 * 1000);
    await sendEmail(passwordResetEmail(email, token));
  }

  return neutral;
}

export async function resetPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = z
    .object({ token: z.string().min(1), password: passwordSchema })
    .safeParse({ token: formData.get("token"), password: formData.get("password") });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const record = await consumeToken(parsed.data.token, "reset_password");
  if (!record) {
    return { error: "That link has expired or has already been used. Ask for a new one." };
  }

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(parsed.data.password), updatedAt: new Date() })
    .where(eq(users.id, record.userId));

  // Every existing session dies. A reset that leaves the thief's session alive has not
  // actually locked anybody out, which is the entire point of resetting.
  await destroyAllSessions(record.userId);

  await logEvent({
    type: "admin_action",
    userId: record.userId,
    actor: "user",
    message: "password was reset",
  });

  redirect("/login?reset=1");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Email verification
// ═══════════════════════════════════════════════════════════════════════════════

export async function verifyEmailToken(token: string): Promise<boolean> {
  const record = await consumeToken(token, "verify_email");
  if (!record) return false;

  await db
    .update(users)
    .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, record.userId));

  return true;
}

export async function resendVerificationAction(): Promise<FormState> {
  const session = await getSessionUser();
  if (!session) return { error: "Sign in first." };
  if (!emailVerificationRequired()) return { success: "Email confirmation isn't in use." };
  if (session.emailVerifiedAt) return { success: "Your email is already confirmed." };

  const limit = rateLimit(`verify:${session.id}`, 3, 60 * 60 * 1000);
  if (!limit.allowed) {
    return { error: "We've sent a few already. Check your spam folder, then try again later." };
  }

  await issueVerificationEmail(session.id, session.email);
  return { success: "Sent. Check your inbox." };
}

async function issueVerificationEmail(userId: string, email: string): Promise<void> {
  const token = await issueToken(userId, "verify_email", 24 * 60 * 60 * 1000);
  await sendEmail(verificationEmail(email, token));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tokens
// ═══════════════════════════════════════════════════════════════════════════════

const tokenHash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

/**
 * Mint a single-use token and return the RAW value, which only ever travels in the email.
 * The database stores its hash, so a leak of email_tokens cannot be used to reset anybody.
 */
async function issueToken(userId: string, purpose: string, ttlMs: number): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");

  // One live token per purpose. Otherwise every "resend" leaves another working key sitting
  // in another inbox, and the oldest one still opens the door.
  await db
    .delete(emailTokens)
    .where(and(eq(emailTokens.userId, userId), eq(emailTokens.purpose, purpose)));

  await db.insert(emailTokens).values({
    id: tokenHash(token),
    userId,
    purpose,
    expiresAt: new Date(Date.now() + ttlMs),
  });

  return token;
}

/** Redeem a token, atomically, exactly once. */
async function consumeToken(token: string, purpose: string): Promise<{ userId: string } | null> {
  const id = tokenHash(token);

  // `used_at IS NULL` in the WHERE clause is what makes this single-use: two requests racing
  // with the same token both try to update, and only one of them matches a row.
  const [claimed] = await db
    .update(emailTokens)
    .set({ usedAt: new Date() })
    .where(
      and(eq(emailTokens.id, id), eq(emailTokens.purpose, purpose), isNull(emailTokens.usedAt))
    )
    .returning({ userId: emailTokens.userId, expiresAt: emailTokens.expiresAt });

  if (!claimed) return null;
  if (claimed.expiresAt.getTime() <= Date.now()) return null;

  return { userId: claimed.userId };
}

// ═══════════════════════════════════════════════════════════════════════════════

async function clientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip")?.trim() ?? "unknown"
  );
}

async function clientUserAgent(): Promise<string | null> {
  return (await headers()).get("user-agent");
}

/**
 * A `next=` parameter that is safe to redirect to.
 *
 * Must be a path on this site. Accepting an absolute URL here is a classic open redirect: an
 * attacker sends `/login?next=https://evil.example`, the victim signs in for real, lands on a
 * convincing copy of this site, and types their password into it.
 */
function asSafePath(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

/**
 * Postgres unique-violation (SQLSTATE 23505), anywhere in the cause chain.
 *
 * Drizzle wraps driver errors in a DrizzleQueryError and hangs the real one off `cause`, so
 * checking `err.code` alone never matches and the exception escapes as a 500. That is exactly
 * what happened the first time this ran: a duplicate signup returned a stack trace instead of
 * the neutral "check your email" page, which both looks broken AND leaks that the address is
 * already registered.
 */
function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;

  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current === "object" && "code" in current && current.code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }

  return false;
}
