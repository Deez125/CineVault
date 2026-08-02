import "server-only";

import { notFound, redirect } from "next/navigation";
import { getSessionUser, type SessionUser } from "./session";

export * from "./session";
export * from "./password";

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
