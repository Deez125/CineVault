import { env, isProduction } from "@/lib/env";

/**
 * Outbound email.
 *
 * No provider is wired up yet, so this logs to the console instead of sending. Every flow that
 * needs email is built against this interface, which means adding Resend or Postmark later is
 * a change to ONE function and nothing else.
 *
 * BEFORE LAUNCH: this must become real. Password reset does not work without it — a customer
 * who forgets their password has no way back into a paid account, and you find out by getting
 * the support ticket. `assertEmailConfigured()` exists so that stays impossible to forget.
 */

export type Email = {
  to: string;
  subject: string;
  /** Plain text. Deliberately not HTML yet: nothing here needs it, and text always renders. */
  text: string;
};

type Transport = (email: Email) => Promise<void>;

const consoleTransport: Transport = async (email) => {
  console.log(
    [
      "",
      "  ┌─ EMAIL (not sent, no provider configured) ─────────────────────────",
      `  │ To:      ${email.to}`,
      `  │ Subject: ${email.subject}`,
      "  ├────────────────────────────────────────────────────────────────────",
      ...email.text.split("\n").map((line) => `  │ ${line}`),
      "  └────────────────────────────────────────────────────────────────────",
      "",
    ].join("\n")
  );
};

const transport: Transport = consoleTransport;

/**
 * Send, or log.
 *
 * Never throws. A failure to send a verification email must not fail the signup that
 * triggered it: the account is created either way, and the user can ask for another link.
 * Losing the account because the mail server hiccuped would be much worse.
 */
export async function sendEmail(email: Email): Promise<void> {
  try {
    await transport(email);
  } catch (err) {
    console.error("[email] send failed:", err instanceof Error ? err.message : err);
  }
}

/** True once a real provider is wired in. */
export function emailConfigured(): boolean {
  return transport !== consoleTransport;
}

/**
 * Refuse to run in production without a mail provider.
 *
 * Called at worker startup. In development the console transport is genuinely useful — the
 * reset link is right there in the terminal. In production it means silently broken password
 * recovery, which is the kind of thing nobody notices until it matters.
 */
export function assertEmailConfigured(): void {
  if (isProduction && !emailConfigured()) {
    throw new Error(
      "No email provider is configured. Password reset and email verification cannot work. " +
        "Wire up a transport in lib/email/index.ts before deploying."
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// The messages themselves
// ═══════════════════════════════════════════════════════════════════════════════

export function verificationEmail(to: string, token: string): Email {
  const url = `${env.APP_URL}/verify?token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: "Confirm your email address",
    text: [
      "Welcome to CineVault.",
      "",
      "Confirm your email address by opening this link:",
      url,
      "",
      "The link is good for 24 hours. If you didn't create an account, you can ignore this.",
    ].join("\n"),
  };
}

export function passwordResetEmail(to: string, token: string): Email {
  const url = `${env.APP_URL}/reset?token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: "Reset your password",
    text: [
      "Someone asked to reset the password on your CineVault account.",
      "",
      "If it was you, set a new one here:",
      url,
      "",
      "The link is good for one hour and can only be used once.",
      "",
      "If it wasn't you, nothing has changed and you can ignore this. Your password still works.",
    ].join("\n"),
  };
}
