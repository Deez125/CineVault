import { protectedPlexUsers } from "@/lib/env";

/**
 * The hard rail.
 *
 * A set of Plex users predate this system: friends and family who were given access directly,
 * long before anybody paid for anything, plus the server owner's own account. They have no
 * subscription, no CineVault account, and no row in our database — and from the system's
 * point of view that makes every one of them look exactly like a freeloader to be cut off.
 *
 * They must NEVER be touched. No share revocation, no stream kills, no exceptions.
 *
 * This is checked before every destructive operation, and it is checked HERE rather than at
 * each call site so there is one place to get it right. The previous build relied on these
 * users simply not being in the database, which was protection by coincidence: the first time
 * one of them made an account, the coincidence would have ended and the bot would have
 * revoked someone who never subscribed to anything.
 *
 * Populated from PLEX_PROTECTED_USERS.
 */

/** True if this Plex username must never be touched. Case-insensitive. */
export function isProtected(plexUsername: string | null | undefined): boolean {
  if (!plexUsername) return false;
  return protectedPlexUsers().includes(plexUsername.trim().toLowerCase());
}

/**
 * Throws if the user is protected.
 *
 * Use at the top of anything that revokes, unshares, or kills. Throwing rather than returning
 * a boolean is deliberate: a caller can forget to check a return value, but cannot forget to
 * catch an exception that stops the function.
 */
export function assertNotProtected(plexUsername: string | null | undefined, action: string): void {
  if (isProtected(plexUsername)) {
    throw new ProtectedUserError(
      `Refusing to ${action} for protected Plex user "${plexUsername}".`
    );
  }
}

export class ProtectedUserError extends Error {
  readonly code = "PROTECTED_USER";
  constructor(message: string) {
    super(message);
    this.name = "ProtectedUserError";
  }
}

/** The current list, for display in the admin panel. */
export function listProtectedUsers(): string[] {
  return protectedPlexUsers();
}
