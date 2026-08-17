import { z } from "zod";

/**
 * Environment configuration, validated once at import.
 *
 * The old build's `config.js` hard-exited on any missing variable, and that was the right
 * instinct: a service that boots with half its credentials will happily take someone's money
 * and then fail to give them anything, which is worse than not booting. We keep that, with
 * one concession — the integrations you can't configure yet (Plex, Tracearr) are allowed to
 * be absent in development so the rest of the app can be built and run. They are REQUIRED in
 * production, and anything that depends on them refuses to run without them.
 */

const required = (name: string) =>
  z.string().min(1, `${name} is required. See .env.example.`);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  /** Where this app is reachable. Used for Stripe return URLs and email links. */
  APP_URL: z.string().url().default("http://localhost:3000"),

  /** postgres://user:pass@host:5432/cinevault */
  DATABASE_URL: required("DATABASE_URL"),

  /**
   * Used for CSRF tokens and any other HMAC we need. NOT used for sessions — those are rows
   * in the database, so they can be revoked. A signed cookie can't be.
   */
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),

  // ── Supabase Auth ─────────────────────────────────────────────────────────
  // Identity lives in Supabase now. The URL and anon key are safe in the browser bundle; the
  // service-role key is not — anything that lists or bans users needs it, but nothing under a
  // "use client" boundary may import a module that reads it.
  NEXT_PUBLIC_SUPABASE_URL: z.string().url("NEXT_PUBLIC_SUPABASE_URL must be a URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  SUPABASE_SERVICE_ROLE_KEY: required("SUPABASE_SERVICE_ROLE_KEY"),

  // ── Stripe ────────────────────────────────────────────────────────────────
  STRIPE_SECRET_KEY: required("STRIPE_SECRET_KEY"),
  /** From `stripe listen` locally, or the endpoint's signing secret in the dashboard. */
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: required("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"),

  // ── Plex ──────────────────────────────────────────────────────────────────
  // Optional in dev so the app boots without them; every Plex code path checks
  // `plexConfigured()` and refuses rather than half-working.
  PLEX_TOKEN: z.string().optional(),
  PLEX_MACHINE_ID: z.string().optional(),
  /** plex.tv SECTION IDS, not the server's library keys. They are different numbers. */
  PLEX_LIBRARY_SECTION_IDS: z.string().optional(),
  PLEX_CLIENT_IDENTIFIER: z.string().optional(),
  /**
   * Plex usernames that predate this system and must NEVER be touched: no share revocation,
   * no stream kills, no exceptions. Comma separated. This is a hard rail, not a preference.
   */
  PLEX_PROTECTED_USERS: z.string().optional(),

  // ── Tracearr (stream monitoring) ──────────────────────────────────────────
  TRACEARR_URL: z.string().optional(),
  TRACEARR_API_KEY: z.string().optional(),

  /**
   * Comma-separated emails that get the admin flag. An empty list means nobody is an admin.
   * That is deliberate: a misconfigured allowlist should lock the door, not open it.
   */
  ADMIN_EMAILS: z.string().default(""),

  /**
   * Whether to ask people to confirm their email address.
   *
   * OFF until a mail provider exists, because with no provider the "check your email" screen
   * is a dead end: there is no message, so there is no way to carry on. Turn it back on in
   * the same change that wires up sending.
   *
   * Read through `emailVerificationRequired()`, which also refuses to let it be on while
   * there is nothing to send with.
   */
  REQUIRE_EMAIL_VERIFICATION: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  /**
   * The floating debug panel.
   *
   * OFF by default, and off in the environment. It reads live Stripe state and can terminate
   * a subscription, so it is opt-in rather than something that appears because somebody
   * happens to be an admin. Flip this to `true` when you want it back.
   */
  ENABLE_DEBUG_PANEL: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  /**
   * Resend, for outbound email.
   *
   * Optional so development still runs without it — the console transport prints reset links
   * to the terminal, which is more convenient than a real inbox. Production refuses to start
   * without it (see assertEmailConfigured), because the failure mode otherwise is silent:
   * password reset appears to work and quietly does nothing.
   */
  RESEND_API_KEY: z.string().optional(),

  /**
   * The From address. Must be on a domain verified in Resend, or every send is rejected.
   *
   * A display name is worth including — "CineVault <noreply@…>" reads as a service, a bare
   * address reads as a script.
   */
  EMAIL_FROM: z.string().default("CineVault <noreply@getcinevault.com>"),

  /**
   * The logo shown in emails. An absolute, PUBLICLY reachable URL.
   *
   * Deliberately not built from APP_URL. An inbox is not a browser tab: Gmail fetches images
   * through its own proxy, from Google's network, so a localhost URL is unreachable and the
   * logo renders as a broken image in every message sent from a development machine. Pointing
   * at production means the logo is right everywhere, including in local test sends.
   *
   * A data: URI would avoid the fetch entirely and is the obvious idea — Gmail blocks them.
   */
  EMAIL_LOGO_URL: z.string().url().default("https://getcinevault.com/logo.png"),

  /**
   * Whether the worker may actually terminate streams.
   *
   * OFF by default, and it stays off until somebody deliberately turns it on. Killing a
   * stream is the most user-hostile thing this system can do, and the failure mode of a
   * mistake is a paying customer's film stopping mid-scene. A deploy must never be able to
   * start doing that on its own.
   *
   * With it off the enforcer still runs, still works out who is over their limit, and still
   * logs what it WOULD have done — so the behaviour can be watched against real traffic
   * before it is allowed to act.
   */
  ENFORCE_STREAM_LIMITS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  /**
   * When true, signup is only reachable via a live referral link — a plain visit to /signup
   * without a valid `ref` gets redirected to /invite-only. Kept as a reversible switch (env
   * flag, no schema changes) so the door can be opened again by flipping the value in
   * Coolify without a deploy. Default off so nothing changes for existing deployments.
   */
  INVITE_ONLY_SIGNUP: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  /**
   * Dry-run mode for the nightly analytics snapshotter. Same pattern as ENFORCE_STREAM_LIMITS
   * — the job still runs, still computes the whole row, and logs what it would insert; it
   * just does not touch the table. Flip to false only after watching one real day's output.
   */
  SNAPSHOT_DRY_RUN: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  // ── Background loop tuning ────────────────────────────────────────────────
  RECONCILE_INTERVAL_MS: z.coerce.number().int().positive().default(5 * 60_000),
  ENFORCE_INTERVAL_MS: z.coerce.number().int().positive().default(20_000),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}\n`);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === "production";

/**
 * True when signup should be gated behind a live referral link. Exposed as a helper so the
 * signup page, the signup server action, and the login page all read the same source of
 * truth — flipping INVITE_ONLY_SIGNUP in Coolify is the whole reversal path.
 */
export function inviteOnlySignup(): boolean {
  return env.INVITE_ONLY_SIGNUP;
}

/** True when every Plex credential is present. */
export function plexConfigured(): boolean {
  return Boolean(
    env.PLEX_TOKEN &&
      env.PLEX_MACHINE_ID &&
      env.PLEX_LIBRARY_SECTION_IDS &&
      env.PLEX_CLIENT_IDENTIFIER
  );
}

/** True when Tracearr is reachable-in-principle. Stream enforcement is off without it. */
export function tracearrConfigured(): boolean {
  return Boolean(env.TRACEARR_URL && env.TRACEARR_API_KEY);
}

/** The plex.tv section ids to share, parsed from the comma-separated env var. */
export function plexSectionIds(): string[] {
  return (env.PLEX_LIBRARY_SECTION_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Plex usernames that must never be touched, lowercased for comparison.
 *
 * Read this through `isProtected()` in lib/plex/protected.ts rather than here — that function
 * is the one place every destructive operation checks, and it should stay that way.
 */
export function protectedPlexUsers(): string[] {
  return (env.PLEX_PROTECTED_USERS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Emails granted the admin flag, lowercased. Empty means nobody. */
export function adminEmails(): string[] {
  return env.ADMIN_EMAILS.split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Called by the worker and by anything that performs access changes. In production a missing
 * Plex credential is fatal: silently not provisioning a paying customer is the failure mode
 * we most want to avoid.
 */
export function assertProductionIntegrations(): void {
  if (!isProduction) return;

  const missing: string[] = [];
  if (!plexConfigured()) missing.push("PLEX_TOKEN/PLEX_MACHINE_ID/PLEX_LIBRARY_SECTION_IDS/PLEX_CLIENT_IDENTIFIER");
  if (!env.STRIPE_WEBHOOK_SECRET) missing.push("STRIPE_WEBHOOK_SECRET");

  if (missing.length) {
    throw new Error(
      `Refusing to run in production without:\n${missing.map((m) => `  - ${m}`).join("\n")}`
    );
  }
}
