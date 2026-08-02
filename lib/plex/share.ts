import type { User } from "@/lib/db/schema";
import { plexConfigured, plexSectionIds } from "@/lib/env";
import { assertNotProtected } from "./protected";
import { share, unshare } from "./client";

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

  const sections = plexSectionIds();
  if (sections.length === 0) {
    // Sharing zero sections technically succeeds and grants access to nothing, which looks
    // to the member like a broken invite and to us like a successful provision.
    throw new Error("PLEX_LIBRARY_SECTION_IDS is empty; a share with no libraries is not a share");
  }

  await share(identity, sections);
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
