import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type User } from "@/lib/db/schema";
import { applyEntitlement } from "@/lib/entitlements";
import { logEvent } from "@/lib/events";
import { adminEmails, plexConfigured } from "@/lib/env";
import { authUrl, checkPin, createPin, type PlexIdentity } from "./client";
import { isProtected } from "./protected";
import { revokePlexAccess } from "./share";

/**
 * Linking a Plex account.
 *
 * Plex has no redeemable invite links: every share needs a real Plex identity up front. So
 * the flow is Plex's own device-PIN dance — the member types a 4-character code at
 * plex.tv/link, and we poll until Plex tells us who they are. We never see their password,
 * and their token is read once and discarded.
 */

export class PlexLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlexLinkError";
  }
}

export type LinkStart = { pinId: number; authUrl: string };

/**
 * Begin a link.
 *
 * Returns the URL to send the member to. They sign in to Plex on Plex's own page and get
 * forwarded back, which is one click if they are already signed in there. We never see their
 * password, and there is no code to type.
 */
export async function startLink(returnUrl: string): Promise<LinkStart> {
  if (!plexConfigured()) {
    throw new PlexLinkError("Plex linking isn't available right now.");
  }

  const pin = await createPin();
  return { pinId: pin.id, authUrl: authUrl(pin.code, returnUrl) };
}

export type LinkPoll =
  | { linked: false }
  | { linked: true; plexUsername: string; warning?: string };

/**
 * Poll a PIN, and if it has been authorised, attach that Plex account and provision.
 *
 * Provisioning goes through applyEntitlement rather than calling the share API here. That
 * function is the only thing allowed to change access, and routing this through it means a
 * member who links while unsubscribed gets exactly what they should: the identity recorded,
 * and no share.
 */
export async function pollLink(user: User, pinId: number): Promise<LinkPoll> {
  const identity = await checkPin(pinId);
  if (!identity) return { linked: false };

  await assertLinkable(user, identity);

  await db
    .update(users)
    .set({
      plexUserId: identity.id,
      plexUsername: identity.username,
      plexEmail: identity.email,
      plexLinkedAt: new Date(),
      // A fresh identity has no share yet, whoever the previous one was.
      shareState: "none",
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  await logEvent({
    type: "plex_linked",
    actor: "user",
    userId: user.id,
    email: user.email,
    plexUsername: identity.username,
    message: `${user.email} linked Plex account ${identity.username}`,
  });

  const result = await applyEntitlement(user.id, { actor: "user" });

  return {
    linked: true,
    plexUsername: identity.username,
    warning: result?.isMember
      ? undefined
      : "You're linked. Your invite goes out as soon as you have a plan.",
  };
}

/**
 * Refuse the link if it would break something.
 *
 * Both of these are refusals rather than warnings, because the alternative in each case is
 * silent and expensive.
 */
async function assertLinkable(user: User, identity: PlexIdentity): Promise<void> {
  // One Plex account per CineVault account. Without this, one person could attach the same
  // Plex account to several cheap subscriptions and stack stream slots for free — and the
  // enforcer, which maps streams to members BY Plex username, would have no way to tell which
  // of them was watching.
  const [taken] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.plexUserId, identity.id), ne(users.id, user.id)))
    .limit(1);

  if (taken) {
    throw new PlexLinkError(
      `That Plex account is already linked to another CineVault account. ` +
        `Unlink it there first, or use a different Plex account.`
    );
  }

  // A protected account predates this system and is shared with directly. Attaching one to a
  // subscription would put it under this system's control, and the first cancellation would
  // revoke access that was never ours to revoke.
  //
  // That risk does not exist for an ADMIN, and the server owner's own account is protected by
  // definition — so without this exception the person who runs the service is the one person
  // who cannot link their Plex account. syncPlexShare returns early for admins, so nothing is
  // ever shared or unshared on their behalf: the link is identity and only identity, which is
  // what lets the enforcer attribute streams to them and skip them deliberately rather than
  // by not recognising them.
  if (isProtected(identity.username) && !adminEmails().includes(user.email.toLowerCase())) {
    throw new PlexLinkError(
      `That Plex account already has direct access to the server and can't be linked here.`
    );
  }
}

/**
 * Detach. Deliberately available to the member.
 *
 * Linking the wrong account (an alt, a family member's) is an easy mistake, and without this
 * there is no way for them to fix it themselves.
 */
export async function unlink(user: User): Promise<void> {
  if (!user.plexUsername && !user.plexUserId) return;

  const previous = user.plexUsername;

  // Pull the share FIRST. Clearing the identity first would leave us with a share we can no
  // longer name, and it would sit on the server forever.
  //
  // Attempted whenever we know who they are on Plex, NOT only when share_state says
  // "invited". That column is our record of what we believe, and unlinking is exactly the
  // moment it might be wrong — a share created by hand, or one left behind by an earlier
  // failure, would otherwise survive with nothing left in the database naming it. `unshare`
  // treats "no such share" as success, so the extra attempt costs one API call and closes the
  // only case where access outlives the account.
  if (previous && !isProtected(previous)) {
    try {
      await revokePlexAccess(user);
    } catch (err) {
      throw new PlexLinkError(
        `Couldn't remove your Plex access, so nothing was changed. ` +
          `Try again in a moment. (${err instanceof Error ? err.message : "unknown error"})`
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
    actor: "user",
    userId: user.id,
    email: user.email,
    plexUsername: previous,
    message: `${user.email} unlinked Plex account ${previous}`,
  });
}
