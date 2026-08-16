import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getSupabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Sessions listing and revocation, for the "signed-in devices" panel on the settings page.
 *
 * Supabase Auth manages sessions server-side (rows in `auth.sessions`) and owns the lookup
 * API. We surface a redacted view of those rows to the member and let them end any of them
 * individually. Ending the CURRENT one is fine — same effect as clicking Sign out.
 *
 * WHY WE READ FROM auth.sessions DIRECTLY when we already have supabaseAdmin.auth.admin:
 *   listUserSessions() exists in newer SDK versions and returns exactly what we want. If it
 *   is unavailable in this project's version it throws AuthApiError — the caller catches
 *   that and falls back to a raw SELECT on auth.sessions (same shape, one dependency less).
 *   Either way, the service role bypasses RLS so it just works.
 */

export type UserSession = {
  id: string;
  createdAt: Date;
  refreshedAt: Date | null;
  userAgent: string | null;
  ip: string | null;
  /** True when this row is the session driving the current request. */
  isCurrent: boolean;
};

/**
 * The current session's id, extracted from the access-token JWT payload.
 *
 * Supabase's Session object does NOT expose session_id directly — only the tokens. The id
 * lives inside the JWT's `session_id` claim, which we can safely decode without verifying
 * signature: the JWT was already validated by supabase.auth.getUser() before we got here.
 */
async function currentSessionId(): Promise<string | null> {
  const supabase = await getSupabaseServer();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return null;

  try {
    const parts = session.access_token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload.session_id === "string" ? payload.session_id : null;
  } catch {
    return null;
  }
}

type RawSession = {
  id: string;
  user_id: string;
  created_at: string | Date;
  updated_at: string | Date | null;
  refreshed_at: string | Date | null;
  user_agent: string | null;
  ip: string | null;
};

/**
 * All active sessions for a user, newest activity first. `isCurrent` marks the one making
 * this request so the UI can label it and disable a foot-gun sign-out click.
 */
export async function listMySessions(userId: string): Promise<UserSession[]> {
  const current = await currentSessionId();

  const rows = await readSessionRows(userId);

  return rows
    .map((row) => ({
      id: row.id,
      createdAt: coerceDate(row.created_at) ?? new Date(0),
      refreshedAt: coerceDate(row.refreshed_at ?? row.updated_at),
      userAgent: row.user_agent,
      ip: row.ip,
      isCurrent: row.id === current,
    }))
    .sort((a, b) => {
      // Current session at the top; otherwise most-recent activity first.
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
      const aTime = a.refreshedAt?.getTime() ?? a.createdAt.getTime();
      const bTime = b.refreshedAt?.getTime() ?? b.createdAt.getTime();
      return bTime - aTime;
    });
}

/**
 * Revoke one specific session for a user.
 *
 * Deletes the row in auth.sessions. Supabase's FK from refresh_tokens to sessions is
 * ON DELETE CASCADE, so the refresh token dies with it and the browser cannot mint another
 * access token when the current one expires. The current access token on that device
 * stays valid until it naturally expires — up to 24h per our project config — which is the
 * same limitation as any JWT-based auth. That's why the ban path also flips banned=true;
 * revoking a specific session is best-effort deprovisioning, not a hard kill.
 *
 * userId is passed in so the caller cannot revoke somebody else's session by guessing an id.
 */
export async function revokeSession(sessionId: string, userId: string): Promise<void> {
  await db.execute(
    sql`DELETE FROM auth.sessions WHERE id = ${sessionId}::uuid AND user_id = ${userId}::uuid`
  );
}

/**
 * Try the admin SDK first (returns richer data if present). Fall back to raw SQL so the
 * feature works even in older or restricted SDK builds.
 */
async function readSessionRows(userId: string): Promise<RawSession[]> {
  const admin = supabaseAdmin.auth.admin as unknown as {
    listUserSessions?: (id: string) => Promise<{
      data: { sessions?: RawSession[] } | null;
      error: unknown;
    }>;
  };

  if (typeof admin.listUserSessions === "function") {
    try {
      const { data, error } = await admin.listUserSessions(userId);
      if (!error && data?.sessions) return data.sessions;
    } catch {
      // Fall through to SQL fallback.
    }
  }

  const rows = await db.execute<RawSession>(
    sql`SELECT id::text, user_id::text, created_at, updated_at, refreshed_at, user_agent, ip::text
        FROM auth.sessions
        WHERE user_id = ${userId}::uuid`
  );
  return Array.isArray(rows) ? (rows as unknown as RawSession[]) : (rows.rows as RawSession[]);
}

function coerceDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}
