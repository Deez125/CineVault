/**
 * What to call somebody.
 *
 * Every field is optional, so this has to degrade all the way down to something usable. The
 * order is what a person would most recognise as themselves: their handle, then their name,
 * then the part of their email before the @ — never the raw email, which puts an address on
 * screen in places (a sidebar, an activity feed) where it does not belong.
 *
 * No imports on purpose: client components use this too.
 */

export type Nameable = {
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email: string;
};

export function displayName(user: Nameable): string {
  if (user.username?.trim()) return user.username.trim();

  const full = [user.firstName, user.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");

  if (full) return full;

  return user.email.split("@")[0];
}

/** The letter for an avatar placeholder. */
export function initial(user: Nameable): string {
  return displayName(user).charAt(0).toUpperCase();
}

// ═══════════════════════════════════════════════════════════════════════════════
// Usernames
// ═══════════════════════════════════════════════════════════════════════════════

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 24;

/** Letters, digits, underscore, hyphen. Must start with a letter or digit. */
const USERNAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

/**
 * Handles nobody may take.
 *
 * Two reasons. Some would collide with routes if usernames ever appear in URLs, and the rest
 * would let somebody pass themselves off as us — a "support" or "admin" handle in a future
 * ticket thread is a convincing way to ask another member for something they should not give.
 */
const RESERVED = new Set([
  "admin", "administrator", "root", "system", "support", "help", "staff", "moderator", "mod",
  "cinevault", "official", "billing", "payments", "security", "api", "www", "mail", "email",
  "settings", "account", "dashboard", "login", "signup", "logout", "me", "user", "users",
  "plex", "stripe", "null", "undefined", "anonymous", "everyone", "here",
]);

export type UsernameProblem = string | null;

/** Returns a human-readable problem, or null when the username is fine. */
export function checkUsername(username: string): UsernameProblem {
  const trimmed = username.trim();

  if (trimmed.length < USERNAME_MIN) {
    return `Usernames are at least ${USERNAME_MIN} characters.`;
  }
  if (trimmed.length > USERNAME_MAX) {
    return `Usernames are at most ${USERNAME_MAX} characters.`;
  }
  if (!USERNAME_PATTERN.test(trimmed)) {
    return "Use letters, numbers, underscores and hyphens, starting with a letter or number.";
  }
  if (RESERVED.has(trimmed.toLowerCase())) {
    return "That username is reserved.";
  }

  return null;
}
