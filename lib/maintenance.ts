/**
 * Periodic housekeeping.
 *
 * Under the previous auth this file swept expired session rows and abandoned pending signups.
 * Both are Supabase's responsibility now — Supabase Auth manages its own refresh-token
 * lifetime and its own unconfirmed-user retention — so the module intentionally exports
 * nothing. Left in place as a landing pad for future cross-cutting housekeeping the worker
 * might grow into. When it does, keep the same rule: nothing here should be `server-only`,
 * because the worker has no request context.
 */

export {};
