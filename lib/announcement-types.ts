/**
 * Announcement constants, safe for the browser.
 *
 * Deliberately its own file with NO imports. These live apart from lib/announcements.ts
 * because that module imports the database, and a client component importing a single
 * constant from it drags the entire Postgres driver into the browser bundle — which fails
 * the build on `Can't resolve 'dns'` and takes the whole app down, not just that page.
 *
 * The rule: anything a "use client" file needs goes here; anything that touches the database
 * stays in lib/announcements.ts.
 */

export const SEVERITIES = ["info", "success", "warning", "destructive"] as const;

export type Severity = (typeof SEVERITIES)[number];

export function isSeverity(value: unknown): value is Severity {
  return typeof value === "string" && (SEVERITIES as readonly string[]).includes(value);
}
