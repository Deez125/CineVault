import type { User } from "@/lib/db/schema";
import { plexConfigured } from "@/lib/env";
import { assertNotProtected } from "./protected";
import { listShares, share, unshare } from "./client";

/**
 * Granting and revoking, at the level `applyEntitlement()` cares about.
 *
 * The one door calls these two functions and nothing else from the Plex layer. Everything
 * about how Plex actually works stays behind them.
 */

export async function grantPlexAccess(user: User): Promise<void> {
  if (!plexConfigured()) {
    throw new Error("Plex is not configured; refusing to pretend a share was created");
  }

  const identity = user.plexEmail ?? user.plexUsername;
  if (!identity) {
    throw new Error(`${user.email} has no linked Plex account to share with`);
  }

  // Which libraries to share, and their translation from key to plex.tv section id, is
  // resolved inside share(). It throws rather than sharing a partial list: a share built
  // from libraries that half-resolved would look like a success and give a paying member
  // some of what they bought.
  await share(identity);
}

export async function revokePlexAccess(user: User): Promise<void> {
  // The hard rail. Checked here as well as in the entitlement engine, because this function
  // is reachable from the admin panel directly and a rail with one gate is not a rail.
  assertNotProtected(user.plexUsername, "revoke Plex access");

  if (!plexConfigured()) {
    throw new Error("Plex is not configured; refusing to pretend a share was removed");
  }

  const identity = user.plexUsername ?? user.plexEmail;
  if (!identity) return;

  await unshare(identity);
}

/**
 * Where a member's invite has got to on Plex.
 *
 *   none      — the server is not shared with them at all
 *   pending   — invited, but they have not accepted it yet
 *   accepted  — they are in, and can watch
 *
 * Asked of PLEX, not of our own share_state column. The column records what we asked for;
 * only Plex knows whether the person on the other end has clicked accept, and that is the
 * whole question here.
 *
 * An invite is often accepted the instant it is created — Plex auto-accepts for anybody who
 * has previously accepted a share from the same server — which is exactly why this has to be
 * checked rather than assumed in either direction.
 */
export type ShareState = "none" | "pending" | "accepted";

export async function getShareState(user: User): Promise<ShareState> {
  const identity = (user.plexUsername ?? user.plexEmail)?.trim().toLowerCase();
  if (!identity) return "none";

  if (!plexConfigured()) {
    throw new Error("Plex is not configured; cannot check the invite");
  }

  const shares = await listShares();
  const match = shares.find(
    (s) => s.username?.toLowerCase() === identity || s.email?.toLowerCase() === identity
  );

  if (!match) return "none";
  return match.acceptedAt ? "accepted" : "pending";
}
