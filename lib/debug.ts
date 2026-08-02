import { env, isProduction } from "@/lib/env";
import type { SessionUser } from "@/lib/auth/session";

/**
 * Who may use the debug panel.
 *
 * It performs destructive things — terminating a live subscription, and more to come — so it
 * is not simply "on in development and off otherwise":
 *
 *   - In development, anyone signed in. Otherwise testing a flow means being an admin, and
 *     the accounts you most want to test with are the ordinary ones.
 *   - In production, admins only. The panel is genuinely useful against real data, but it
 *     must never be reachable by a customer who guesses a URL.
 *
 * Every debug endpoint checks this for itself. Hiding the button is presentation; this is the
 * actual gate.
 */
export function debugAllowed(user: Pick<SessionUser, "isAdmin"> | null): boolean {
  // The switch comes first, and it is off by default. Everything below is about WHO may use
  // the panel; this is about whether the panel exists at all.
  if (!env.ENABLE_DEBUG_PANEL) return false;

  if (!user) return false;
  return isProduction ? user.isAdmin : true;
}
