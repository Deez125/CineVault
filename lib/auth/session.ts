import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type User } from "@/lib/db/schema";
import { getSupabaseServer } from "@/lib/supabase/server";
import { adminEmails } from "@/lib/env";

/**
 * Sessions.
 *
 * Identity lives in Supabase Auth now. A "session" is a Supabase-issued JWT held in the auth
 * cookie; a signed-in visitor is one whose cookie's JWT verifies with Supabase and whose UUID
 * has a matching row in our `users` table (installed by the trigger in migration 0010).
 *
 * getSessionUser is the read side of everything the app calls "the current user". The shape
 * it returns is deliberately unchanged from the previous session-rows-in-Postgres world so
 * that requireUser/requireMember/requireAdmin and every server component read continues to
 * work without change. Only WHERE identity comes from has moved.
 *
 * Note on the JWT: getUser() (not getSession()) — the former verifies with Supabase's auth
 * server and refreshes if needed; the latter only reads the cookie, which a tampered client
 * could set to whatever it liked. Never use getSession() in server code.
 */

export type SessionUser = Pick<
  User,
  | "id"
  | "email"
  | "firstName"
  | "lastName"
  | "username"
  | "isAdmin"
  | "banned"
  | "emailVerifiedAt"
  // Derived and written only by applyEntitlement; read-only everywhere else.
  | "isMember"
  | "streamLimit"
  | "plexUserId"
  | "navSeen"
>;

/**
 * The signed-in user, or null.
 *
 * Two lookups: Supabase for the JWT (identity), then our own `users` row for everything else
 * (subscription, Plex, profile). The trigger keeps them in step, so a valid auth user
 * without a profile row is an error worth swallowing here (return null) and investigating
 * separately, not a state to paper over.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await getSupabaseServer();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) return null;

  const [profile] = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      username: users.username,
      isAdmin: users.isAdmin,
      banned: users.banned,
      emailVerifiedAt: users.emailVerifiedAt,
      isMember: users.isMember,
      streamLimit: users.streamLimit,
      plexUserId: users.plexUserId,
      navSeen: users.navSeen,
    })
    .from(users)
    .where(eq(users.id, authUser.id))
    .limit(1);

  if (!profile) return null;

  // Admin comes from ADMIN_EMAILS evaluated NOW, not from the stored column. The column is a
  // cache kept in step opportunistically; the allowlist is authoritative. Deriving here means
  // adding or removing an email takes effect on the very next request rather than on a
  // future write that may never happen.
  const isAdmin = adminEmails().includes(profile.email);

  if (isAdmin !== profile.isAdmin) {
    await db.update(users).set({ isAdmin, updatedAt: new Date() }).where(eq(users.id, profile.id));
  }

  return { ...profile, isAdmin };
}

/**
 * The signed-in user's FULL row, or null.
 *
 * `getSessionUser()` returns only what a page render needs. Anything reasoning about
 * subscription or Plex state wants the whole row.
 */
export async function getCurrentUser(): Promise<User | null> {
  const session = await getSessionUser();
  if (!session) return null;

  const [user] = await db.select().from(users).where(eq(users.id, session.id)).limit(1);
  return user ?? null;
}

/**
 * Sign out of this device.
 *
 * Delegates to Supabase, which clears the auth cookie on the response. "This device" only —
 * Supabase's `scope: "global"` also invalidates every refresh token for the user, which we
 * use for banning and password changes but NOT for an ordinary sign-out.
 */
export async function signOut(): Promise<void> {
  const supabase = await getSupabaseServer();
  await supabase.auth.signOut();
}

/**
 * Sign out EVERY device for this user. Called on password change and on ban.
 *
 * scope: "global" invalidates all refresh tokens for the user. Existing access tokens stay
 * valid until they naturally expire — Supabase's JWTs cannot be revoked mid-flight — so a
 * ban has an up-to-one-access-token-lifetime gap before it fully takes effect. For an
 * immediate lockout we combine this with `supabase.auth.admin.updateUserById(id,
 * { ban_duration: 'none' })` in the ban action, which flips a flag Supabase itself refuses
 * to authenticate against.
 */
export async function signOutAllDevices(): Promise<void> {
  const supabase = await getSupabaseServer();
  await supabase.auth.signOut({ scope: "global" });
}
