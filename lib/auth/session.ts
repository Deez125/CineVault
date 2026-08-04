import "server-only";

import crypto from "node:crypto";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions, users, type User } from "@/lib/db/schema";
import { adminEmails, isProduction } from "@/lib/env";

/**
 * Sessions.
 *
 * A session is a ROW, not a signed cookie. The difference matters here: this app can revoke
 * someone's paid access, and it must be able to revoke their session too. Changing a
 * password, banning an account, or an admin killing a stolen session all take effect on the
 * next request. With a stateless signed cookie they would take effect whenever it expired,
 * which is not a security control, it is a waiting period.
 *
 * The cookie holds a random token. The DATABASE holds only its SHA-256. If the sessions table
 * leaks, nothing in it can be used to sign in as anybody.
 */

const COOKIE = "cv_session";
const DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
/** Past this point into its life, a session gets extended on use. */
const RENEW_AFTER_MS = DURATION_MS / 2;

const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

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
  // Carried on the session so guards and the sidebar can ask "have they paid?" without a
  // second query on every request. Written only by applyEntitlement; read-only everywhere else.
  | "isMember"
  | "streamLimit"
  | "plexUserId"
  | "navSeen"
>;

/**
 * Issue a session and set the cookie.
 *
 * Returns the raw token as well, for the rare caller that needs it (tests, a future API
 * token flow). Everything in the app should just rely on the cookie.
 */
export async function createSession(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {}
): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + DURATION_MS);

  await db.insert(sessions).values({
    id: hash(token),
    userId,
    expiresAt,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 400) ?? null,
  });

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
    expires: expiresAt,
  });

  return token;
}

/**
 * The signed-in user, or null.
 *
 * Reads the cookie, joins to the user, and enforces expiry. Also extends a session that is
 * more than halfway through its life, so an active user is never signed out mid-use while an
 * abandoned session still ages out.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;

  const id = hash(token);

  const [row] = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
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
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, id))
    .limit(1);

  if (!row) return null;

  if (row.expiresAt.getTime() <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }

  if (row.expiresAt.getTime() - Date.now() < RENEW_AFTER_MS) {
    const expiresAt = new Date(Date.now() + DURATION_MS);
    await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
    (await cookies()).set(COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
      path: "/",
      expires: expiresAt,
    });
  }

  // Admin comes from the ADMIN_EMAILS allowlist, evaluated NOW, not from the stored column.
  //
  // The column is only written at signup, so an account created before its address was added
  // to the list would never become an admin no matter what the environment said — and, worse,
  // an account removed from the list would stay an admin forever. Deriving it here means both
  // directions take effect on the very next request.
  //
  // The column is kept in step opportunistically so admin listings and queries can still use
  // it, but nothing trusts it for authorisation.
  const isAdmin = adminEmails().includes(row.email);

  if (isAdmin !== row.isAdmin) {
    await db.update(users).set({ isAdmin, updatedAt: new Date() }).where(eq(users.id, row.id));
  }

  return {
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    username: row.username,
    isAdmin,
    banned: row.banned,
    emailVerifiedAt: row.emailVerifiedAt,
    isMember: row.isMember,
    streamLimit: row.streamLimit,
    plexUserId: row.plexUserId,
    navSeen: row.navSeen,
  };
}

/**
 * The signed-in user's FULL row, or null.
 *
 * `getSessionUser()` returns only identity, which is what almost every page needs and keeps
 * the common query small. Anything that has to reason about subscription or Plex state wants
 * this instead.
 */
export async function getCurrentUser(): Promise<User | null> {
  const session = await getSessionUser();
  if (!session) return null;

  const [user] = await db.select().from(users).where(eq(users.id, session.id)).limit(1);
  return user ?? null;
}

/** Sign out of this device. */
export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;

  if (token) await db.delete(sessions).where(eq(sessions.id, hash(token)));
  jar.delete(COOKIE);
}

/**
 * Sign out of everything.
 *
 * Called on password change and on ban. A password reset that leaves the thief's existing
 * session alive has not actually locked anyone out.
 */
export async function destroyAllSessions(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/** Used by the "signed in devices" list on the settings page. */
export async function listSessions(userId: string) {
  return db
    .select({
      id: sessions.id,
      createdAt: sessions.createdAt,
      expiresAt: sessions.expiresAt,
      ip: sessions.ip,
      userAgent: sessions.userAgent,
    })
    .from(sessions)
    .where(and(eq(sessions.userId, userId)));
}
