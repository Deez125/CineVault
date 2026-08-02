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
