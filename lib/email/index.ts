import { env, isProduction } from "@/lib/env";

/**
 * Outbound email.
 *
 * Resend when RESEND_API_KEY is set, the console otherwise. Development deliberately keeps the
 * console: a reset link printed in the terminal is faster to use than a real inbox, and it
 * costs nothing against the daily send limit.
 *
 * Sent over plain fetch rather than the `resend` package. It is one POST with a JSON body, and
 * a dependency that ships an SDK, its types and its own HTTP client to save four lines is a
 * dependency that will need updating for the rest of the project's life.
 */

export type Email = {
  to: string;
  subject: string;
  /**
   * Plain text, and NOT optional.
   *
   * Sent alongside the HTML as a multipart alternative. Some people read mail as text, some
   * clients strip HTML, and a spam filter that finds an HTML-only message is more suspicious
   * of it. The text version is the one guaranteed to render, so it has to stand on its own
   * rather than say "view this in a browser".
   */
  text: string;
  html?: string;
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

/**
 * Resend's REST API.
 *
 * Throws on a non-2xx so sendEmail can log the reason. Resend's errors are specific and worth
 * seeing verbatim — "domain is not verified" and "invalid api key" are different problems with
 * different fixes, and collapsing them into "send failed" costs an afternoon.
 */
const resendTransport: Transport = async (email) => {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [email.to],
      subject: email.subject,
      text: email.text,
      ...(email.html ? { html: email.html } : {}),
    }),
    // Long enough for a slow API, short enough that a hung request cannot hold a signup open.
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`resend ${res.status}: ${body.slice(0, 300)}`);
  }
};

const transport: Transport = env.RESEND_API_KEY ? resendTransport : consoleTransport;

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
 * Should we ask people to confirm their email address?
 *
 * Requires BOTH the flag and a real provider. Turning the flag on without one would park
 * every new signup on a "check your email" page waiting for a message that can never arrive
 * — a dead end, and worse than not verifying at all.
 *
 * Nothing gates access on verification today; it is a nudge, not a lock. When that changes,
 * this is the one function to consult.
 */
export function emailVerificationRequired(): boolean {
  if (!env.REQUIRE_EMAIL_VERIFICATION) return false;

  if (!emailConfigured()) {
    console.warn(
      "[email] REQUIRE_EMAIL_VERIFICATION is on but no provider is configured. " +
        "Treating verification as disabled so signups are not stranded."
    );
    return false;
  }

  return true;
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


// ═══════════════════════════════════════════════════════════════════════════════
// Presentation
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * One HTML shell for every message.
 *
 * Deliberately old-fashioned markup: a centred table, inline styles, no classes. Email
 * clients are not browsers — Outlook renders with Word, Gmail strips <style> blocks — and
 * anything modern degrades into a wall of unstyled text somewhere.
 *
 * The logo sits on a DARK band because it is a white mark. On the white background most
 * clients default to, it would be invisible; a header block makes that deliberate rather
 * than accidental. Its URL is absolute and points at PRODUCTION even in development — see
 * EMAIL_LOGO_URL — and many clients block images until asked, so nothing important is ever
 * said in it.
 */
function layout(body: string): string {
  const logo = env.EMAIL_LOGO_URL;

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px 12px;background:#f4f5f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" width="100%" style="max-width:560px;margin:0 auto;border-collapse:collapse;">
      <tr>
        <td style="background:#0f1115;padding:24px;text-align:center;border-radius:12px 12px 0 0;">
          <img src="${logo}" width="40" height="40" alt="CineVault" style="display:block;margin:0 auto 10px;border:0;" />
          <div style="color:#ffffff;font-size:17px;font-weight:600;letter-spacing:-0.01em;">CineVault</div>
        </td>
      </tr>
      <tr>
        <td style="background:#ffffff;padding:32px 28px;border:1px solid #e4e7ec;border-top:0;border-radius:0 0 12px 12px;color:#111318;font-size:15px;line-height:1.6;">
${body}
        </td>
      </tr>
      <tr>
        <td style="padding:18px 8px;text-align:center;color:#646c7e;font-size:12px;line-height:1.5;">
          This is an automated message from CineVault. Replies to it are not monitored.
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** A tappable button that still looks like one where CSS is stripped. */
function button(href: string, label: string): string {
  return `          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
            <tr>
              <td style="background:#2563eb;border-radius:8px;">
                <a href="${href}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">${label}</a>
              </td>
            </tr>
          </table>`;
}

export function verificationEmail(to: string, token: string): Email {
  const url = `${env.APP_URL}/verify?token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: "Confirm your email address",
    text: [
      "Please confirm your email address to finish setting up your CineVault account.",
      "",
      "Confirm your email address:",
      url,
      "",
      "This link will expire in 24 hours.",
      "",
      "If you did not create a CineVault account, you can safely ignore this email.",
    ].join("\n"),
    html: layout(
      `          <p style="margin:0 0 16px;">Please confirm your email address to finish setting up your CineVault account.</p>
${button(url, "Confirm email address")}
          <p style="margin:0 0 16px;color:#646c7e;font-size:13px;">Or paste this link into your browser:<br /><a href="${url}" style="color:#2563eb;word-break:break-all;">${url}</a></p>
          <p style="margin:0 0 16px;">This link will expire in <strong>24 hours</strong>.</p>
          <p style="margin:0;color:#646c7e;">If you did not create a CineVault account, you can safely ignore this email.</p>`
    ),
  };
}

export function passwordResetEmail(to: string, token: string): Email {
  const url = `${env.APP_URL}/reset?token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: "Reset your password",
    text: [
      "We received a request to reset the password for your CineVault account.",
      "",
      "To choose a new password, open this link:",
      url,
      "",
      "This link will expire in 1 hour and can only be used once.",
      "",
      "If you did not request a password reset, you can safely ignore this email.",
      "Your password will not be changed.",
    ].join("\n"),
    html: layout(
      `          <p style="margin:0 0 16px;">We received a request to reset the password for your CineVault account.</p>
${button(url, "Reset your password")}
          <p style="margin:0 0 16px;color:#646c7e;font-size:13px;">Or paste this link into your browser:<br /><a href="${url}" style="color:#2563eb;word-break:break-all;">${url}</a></p>
          <p style="margin:0 0 16px;">This link will expire in <strong>1 hour</strong> and can only be used once.</p>
          <p style="margin:0;color:#646c7e;">If you did not request a password reset, you can safely ignore this email. Your password will not be changed.</p>`
    ),
  };
}
