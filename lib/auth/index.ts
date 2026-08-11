import "server-only";

import { notFound, redirect } from "next/navigation";
import { getSessionUser, type SessionUser } from "./session";
import { emailVerificationRequired } from "@/lib/email";

export * from "./session";

/**
 * Guards.
 *
 * The rule the previous build learned the hard way: **gate the data, not just the page.** A
 * check that only runs in a page component is theatre, because the route handlers behind it
 * still answer. Every route handler and every server action calls one of these itself.
 */

/** The signed-in user, or redirect to sign-in and come back here afterwards. */
export async function requireUser(returnTo?: string): Promise<SessionUser> {
  const user = await getSessionUser();

  if (!user) {
    const next = returnTo ? `?next=${encodeURIComponent(returnTo)}` : "";
    redirect(`/login${next}`);
  }

  // A banned account keeps its session but can't use the app. Handled here rather than by
  // deleting their session, so they get an explanation instead of a silent sign-out loop.
  if (user.banned) redirect("/banned");

  /**
   * An unverified account cannot use the app at all.
   *
   * Under the verify-first signup flow this should be unreachable: an unconfirmed address
   * lives in `pending_signups` and has no account and no session, so there is nothing here to
   * catch. It exists for the accounts that predate that flow, and as the backstop if any
   * future path ever creates a user without confirming the address.
   *
   * In the layout rather than on each page, so a new page is covered by existing rather than
   * by remembering. Route handlers and server actions still check for themselves.
   */
  if (emailVerificationRequired() && !user.emailVerifiedAt) {
    redirect(`/check-email?email=${encodeURIComponent(user.email)}`);
  }

  return user;
}

/**
 * The signed-in admin, or 404.
 *
 * Deliberately not a redirect to sign-in: someone who isn't an admin should not learn that
 * an admin panel exists at this URL.
 */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user || !user.isAdmin || user.banned) notFound();
  return user;
}

/**
 * A signed-in MEMBER — somebody with a live plan — or 404.
 *
 * Plex linking and referrals are things you get for paying. Before that they are not
 * "locked", they simply are not part of the account yet, and 404 says that more honestly than
 * a teaser page: there is nothing at this address for you.
 *
 * Admins pass because applyEntitlement makes them members without paying.
 *
 * Gating referrals this way also closes a real hole rather than merely hiding one. A referrer
 * with no Stripe customer cannot be credited, so the reward was skipped and left pending —
 * and nothing ever retried it, because payout fires when the REFEREE pays and they already
 * had. Requiring a plan to reach the page means every referrer has a customer to credit.
 */
export async function requireMember(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user || user.banned) notFound();
  if (!isMemberOrAdmin(user)) notFound();
  return user;
}

/**
 * Has a plan, or runs the place.
 *
 * `isAdmin` is checked explicitly rather than relying on applyEntitlement having set
 * `isMember`. That column is derived and only written when entitlement is recalculated, so a
 * freshly created admin account carries `isMember: false` until something happens to trigger
 * it — and an admin locked out of Plex on the day they sign up would be a puzzling bug to
 * chase. Admin status comes from the ADMIN_EMAILS allowlist on every request, so it is the
 * fresher of the two facts.
 */
export function isMemberOrAdmin(user: Pick<SessionUser, "isAdmin" | "isMember">): boolean {
  return user.isAdmin || user.isMember;
}

/**
 * The API equivalents. These RETURN a Response instead of throwing a redirect, because a
 * fetch() from the browser wants a 401 it can handle, not an HTML sign-in page.
 */
export async function apiUser(): Promise<
  { ok: true; user: SessionUser } | { ok: false; response: Response }
> {
  const user = await getSessionUser();

  if (!user) {
    return {
      ok: false,
      response: Response.json({ error: "not signed in" }, { status: 401 }),
    };
  }

  if (user.banned) {
    return {
      ok: false,
      response: Response.json({ error: "this account is suspended" }, { status: 403 }),
    };
  }

  return { ok: true, user };
}

/**
 * The API equivalent of requireMember. 404, like apiAdmin, so a non-member learns nothing
 * about what exists behind these routes.
 */
export async function apiMember(): Promise<
  { ok: true; user: SessionUser } | { ok: false; response: Response }
> {
  const user = await getSessionUser();

  if (!user || user.banned || !isMemberOrAdmin(user)) {
    return {
      ok: false,
      response: Response.json({ error: "not found" }, { status: 404 }),
    };
  }

  return { ok: true, user };
}

export async function apiAdmin(): Promise<
  { ok: true; user: SessionUser } | { ok: false; response: Response }
> {
  const user = await getSessionUser();

  // One message for "not signed in", "not an admin", and "banned". Distinguishing them tells
  // an attacker which half of the problem to work on.
  if (!user || !user.isAdmin || user.banned) {
    return {
      ok: false,
      response: Response.json({ error: "not found" }, { status: 404 }),
    };
  }

  return { ok: true, user };
}
