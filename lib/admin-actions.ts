import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type User } from "@/lib/db/schema";
import { applyEntitlement } from "@/lib/entitlements";
import { logEvent } from "@/lib/events";
import { destroyAllSessions } from "@/lib/auth/session";
import { plexConfigured } from "@/lib/env";
import { terminateAllSubscriptions } from "@/lib/stripe/subscription";
import { grantPlexAccess, revokePlexAccess } from "@/lib/plex/share";
import { assertNotProtected, isProtected } from "@/lib/plex/protected";

/**
 * The things an admin can do TO somebody.
 *
 * These are the sharpest tools in the system, so two rules hold throughout:
 *
 *   1. **Nothing writes entitlement directly.** Every one of these changes the thing that
 *      GRANTS access — the Stripe subscription, the ban flag, the Plex link — and then lets
 *      applyEntitlement work out what follows. An admin panel that set `is_member` itself
 *      would be a second answer to who has access, and the reconciler would undo it within
 *      five minutes anyway.
 *
 *   2. **The protected rail applies to admins too.** A misclick on one of the 17 pre-existing
 *      Plex accounts must not revoke access that was never ours to grant.
 */

export class AdminActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminActionError";
  }
}

type Ctx = { adminId: string; adminEmail: string };

const actorOf = (ctx: Ctx) => `admin:${ctx.adminId}` as const;

/**
 * End the subscription now, with no remaining paid period.
 *
 * Cancels in STRIPE rather than pulling the Plex share, because pulling the share alone
 * achieves nothing: the next reconcile sees a live subscription and re-invites them within
 * five minutes.
 */
export async function adminRevoke(user: User, ctx: Ctx) {
  const terminated = await terminateAllSubscriptions(user);
  await applyEntitlement(user.id, { actor: actorOf(ctx) });

  await logEvent({
    type: "admin_action",
    severity: "warn",
    actor: actorOf(ctx),
    userId: user.id,
    email: user.email,
    plexUsername: user.plexUsername,
    message: `${ctx.adminEmail} revoked ${user.email}`,
    detail: { terminated },
  });

  return { terminated: terminated.length };
}

/**
 * Ban. They get nothing even if they pay again.
 *
 * The flag is checked inside applyEntitlement, so a webhook arriving a second later cannot
 * quietly undo it. Their sessions are destroyed too — leaving a banned person signed in
 * means they keep browsing an account that no longer works and open a support ticket about
 * it.
 */
export async function adminBan(user: User, reason: string | null, ctx: Ctx) {
  await db
    .update(users)
    .set({ banned: true, bannedAt: new Date(), bannedReason: reason, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  await terminateAllSubscriptions(user);
  await applyEntitlement(user.id, { actor: actorOf(ctx) });
  await destroyAllSessions(user.id);

  await logEvent({
    type: "user_banned",
    severity: "warn",
    actor: actorOf(ctx),
    userId: user.id,
    email: user.email,
    plexUsername: user.plexUsername,
    message: `${ctx.adminEmail} banned ${user.email}`,
    detail: { reason },
  });
}

export async function adminUnban(user: User, ctx: Ctx) {
  await db
    .update(users)
    .set({ banned: false, bannedAt: null, bannedReason: null, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  // Does NOT restore access on its own. If they resubscribe, entitlement follows; if they
  // did not, lifting a ban should not hand back a subscription they no longer pay for.
  await applyEntitlement(user.id, { actor: actorOf(ctx) });

  await logEvent({
    type: "user_unbanned",
    actor: actorOf(ctx),
    userId: user.id,
    email: user.email,
    message: `${ctx.adminEmail} lifted the ban on ${user.email}`,
  });
}

/**
 * Re-send the Plex share.
 *
 * For when somebody is entitled but the invite never landed — a Plex hiccup, or a link made
 * while Plex was unconfigured. Refuses when they are not entitled, rather than quietly
 * granting access an admin did not mean to give.
 */
export async function adminReinvite(user: User, ctx: Ctx) {
  if (!user.plexUsername && !user.plexEmail) {
    throw new AdminActionError("That account has no Plex account linked.");
  }
  if (!user.isMember) {
    throw new AdminActionError("That account has no active plan, so there is nothing to share.");
  }
  if (!plexConfigured()) {
    throw new AdminActionError("Plex is not configured.");
  }
  if (isProtected(user.plexUsername)) {
    throw new AdminActionError("That Plex account is protected and is managed outside this system.");
  }

  await grantPlexAccess(user);

  await db
    .update(users)
    .set({ shareState: "invited", invitedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, user.id));

  await logEvent({
    type: "access_granted",
    actor: actorOf(ctx),
    userId: user.id,
    email: user.email,
    plexUsername: user.plexUsername,
    message: `${ctx.adminEmail} re-sent the Plex invite to ${user.plexUsername}`,
  });
}

/**
 * Detach their Plex account.
 *
 * Pulls the share FIRST. Clearing the identity first would leave a share we can no longer
 * name, sitting on the server forever.
 */
export async function adminUnlinkPlex(user: User, ctx: Ctx) {
  if (!user.plexUsername && !user.plexUserId) {
    throw new AdminActionError("That account has no Plex account linked.");
  }

  assertNotProtected(user.plexUsername, "unlink Plex");

  const previous = user.plexUsername;

  if (user.shareState === "invited" && plexConfigured()) {
    try {
      await revokePlexAccess(user);
    } catch (err) {
      throw new AdminActionError(
        `Couldn't remove their Plex access, so nothing was changed. ${err instanceof Error ? err.message : ""}`
      );
    }
  }

  await db
    .update(users)
    .set({
      plexUserId: null,
      plexUsername: null,
      plexEmail: null,
      plexLinkedAt: null,
      shareState: "none",
      removedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  await logEvent({
    type: "plex_unlinked",
    severity: "warn",
    actor: actorOf(ctx),
    userId: user.id,
    email: user.email,
    plexUsername: previous,
    message: `${ctx.adminEmail} unlinked ${previous} from ${user.email}`,
  });
}

/** Force a re-check against Stripe for one member. */
export async function adminReconcile(user: User, ctx: Ctx) {
  const result = await applyEntitlement(user.id, { actor: actorOf(ctx) });
  return { changed: Boolean(result?.changed), isMember: result?.isMember ?? false };
}

export const ADMIN_ACTIONS = [
  "revoke",
  "ban",
  "unban",
  "reinvite",
  "unlink",
  "reconcile",
] as const;

export type AdminAction = (typeof ADMIN_ACTIONS)[number];
