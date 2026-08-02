import { env } from "@/lib/env";

/**
 * Low-level plex.tv HTTP.
 *
 * NOTE: written from the documented API and the previous build's hard-won notes, but NOT yet
 * exercised against a real server — the Plex credentials were not available when this was
 * written. Treat the first live run as the real test.
 *
 * Things that are already known to bite here, carried forward so they are not relearned:
 *
 *   - Plex has NO invite links. Every share needs a real Plex identity up front, which is why
 *     linking uses the device-PIN flow to learn who someone is before we can share anything.
 *
 *   - Library KEYS are not plex.tv SECTION IDS. A server reports `<Section id="143184126"
 *     key="11">`; the share API wants the `id`, while the server's own /library/sections
 *     reports the `key`. Passing a key gets you "404 Not found", worded as though the SERVER
 *     did not exist, which sends you debugging entirely the wrong thing.
 *
 *   - HTTP 422 is overloaded. It means both "already shared" (benign, ignore it) and "you
 *     have hit the ~100 user share cap" (an emergency: every new member fails from here on).
 *     Read the body. Never trust the code alone.
 */

const PLEX_TV = "https://plex.tv";

/** Identifies this app to Plex. Shown to users on their authorised-devices page. */
export function plexHeaders(token?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Plex-Product": "CineVault",
    "X-Plex-Version": "1.0",
    "X-Plex-Client-Identifier": env.PLEX_CLIENT_IDENTIFIER ?? "",
    "X-Plex-Platform": "Web",
    "X-Plex-Device": "CineVault",
  };
  if (token) headers["X-Plex-Token"] = token;
  return headers;
}

export class PlexError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string
  ) {
    super(message);
    this.name = "PlexError";
  }

  /**
   * True when a 422 is Plex saying the server has hit its share cap.
   *
   * This is the one that matters operationally: once the cap is hit, EVERY new member fails
   * to be provisioned, quietly, one at a time. It needs to be distinguishable from the
   * harmless "already shared" 422 so it can be surfaced instead of swallowed.
   */
  get isShareCapReached(): boolean {
    if (this.status !== 422) return false;
    const body = this.body.toLowerCase();
    return (
      body.includes("maximum") ||
      body.includes("limit") ||
      body.includes("too many") ||
      body.includes("cap")
    );
  }

  /** True when a 422 just means the share already exists, which is a success for our purposes. */
  get isAlreadyShared(): boolean {
    if (this.status !== 422) return false;
    return !this.isShareCapReached;
  }
}

export async function plexFetch(
  path: string,
  init: RequestInit & { token?: string | null } = {}
): Promise<Response> {
  const { token, ...rest } = init;

  const res = await fetch(`${PLEX_TV}${path}`, {
    ...rest,
    headers: { ...plexHeaders(token ?? env.PLEX_TOKEN), ...(rest.headers ?? {}) },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new PlexError(`plex ${path} failed: ${res.status}`, res.status, body);
  }

  return res;
}

export async function plexJson<T>(
  path: string,
  init: RequestInit & { token?: string | null } = {}
): Promise<T> {
  const res = await plexFetch(path, init);
  return (await res.json()) as T;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Identity — the device PIN flow
// ═══════════════════════════════════════════════════════════════════════════════

export type PlexPin = { id: number; code: string };

/**
 * Start a link. Returns a 4-character code the user types at plex.tv/link.
 *
 * Do NOT add `?strong=true`. It returns a 25-character code, and plex.tv/link will not accept
 * one — the page only takes the short form. That mistake produces a code that looks fine and
 * is simply impossible to use.
 */
export async function createPin(): Promise<PlexPin> {
  const pin = await plexJson<{ id: number; code: string }>("/api/v2/pins", {
    method: "POST",
    token: null,
    body: new URLSearchParams({ strong: "false" }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  return { id: pin.id, code: pin.code };
}

export type PlexIdentity = {
  id: string;
  username: string;
  email: string | null;
};

/**
 * Check whether a PIN has been authorised.
 *
 * Returns null while the user hasn't finished. Once they have, Plex hands over THEIR token —
 * which we use exactly once, to ask who they are, and then discard. We never store a member's
 * Plex token: we have no use for it, and storing it would make this database far more
 * dangerous to lose than it needs to be.
 */
export async function checkPin(pinId: number): Promise<PlexIdentity | null> {
  const pin = await plexJson<{ authToken: string | null }>(`/api/v2/pins/${pinId}`, {
    token: null,
  });

  if (!pin.authToken) return null;

  const user = await plexJson<{ id: number | string; username: string; email: string | null }>(
    "/api/v2/user",
    { token: pin.authToken }
  );

  return {
    id: String(user.id),
    username: user.username,
    email: user.email ?? null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sharing
// ═══════════════════════════════════════════════════════════════════════════════

export type SharedServer = {
  id: number;
  username: string | null;
  email: string | null;
};

/** Everyone the server is currently shared with. */
export async function listShares(): Promise<SharedServer[]> {
  const machineId = env.PLEX_MACHINE_ID;
  const raw = await plexJson<unknown>(`/api/servers/${machineId}/shared_servers`);

  // Plex's shape here varies by endpoint version, so normalise defensively rather than
  // trusting one layout and getting an empty list (which would read as "nobody is shared
  // with" and trigger a re-invite for everybody).
  const container =
    (raw as { MediaContainer?: { SharedServer?: unknown[] } }).MediaContainer ?? raw;
  const list =
    (container as { SharedServer?: unknown[] }).SharedServer ??
    (container as { sharedServers?: unknown[] }).sharedServers ??
    [];

  return (Array.isArray(list) ? list : []).map((entry) => {
    const e = entry as Record<string, unknown>;
    return {
      id: Number(e.id),
      username: (e.username as string) ?? null,
      email: (e.email as string) ?? (e.invitedEmail as string) ?? null,
    };
  });
}

/**
 * Share the configured library sections with a Plex account.
 *
 * "Already shared" is treated as SUCCESS. This function's job is to make the share exist, and
 * it already does — failing here would make the reconciler retry forever and log an error
 * every five minutes for a member who is perfectly fine.
 */
export async function share(invitedEmailOrUsername: string, sectionIds: string[]): Promise<void> {
  const machineId = env.PLEX_MACHINE_ID;

  try {
    await plexFetch(`/api/servers/${machineId}/shared_servers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shared_server: {
          library_section_ids: sectionIds.map(Number),
          invited_email: invitedEmailOrUsername,
        },
      }),
    });
  } catch (err) {
    if (err instanceof PlexError && err.isAlreadyShared) return;

    if (err instanceof PlexError && err.isShareCapReached) {
      throw new PlexShareCapError(
        `Plex refused the share: the server has reached its user cap. ` +
          `Every new member will fail to be provisioned until somebody is removed. Body: ${err.body}`
      );
    }

    throw err;
  }
}

/** Stop sharing with a Plex account. A share that doesn't exist is already the goal. */
export async function unshare(usernameOrEmail: string): Promise<void> {
  const machineId = env.PLEX_MACHINE_ID;
  const needle = usernameOrEmail.trim().toLowerCase();

  const shares = await listShares();
  const match = shares.find(
    (s) => s.username?.toLowerCase() === needle || s.email?.toLowerCase() === needle
  );

  if (!match) return;

  await plexFetch(`/api/servers/${machineId}/shared_servers/${match.id}`, { method: "DELETE" });
}

/**
 * Thrown when Plex reports its share cap. Deliberately its own type: this is not a
 * per-member failure to be logged and retried, it is a service-wide outage of new signups
 * and needs to be visible.
 */
export class PlexShareCapError extends Error {
  readonly code = "PLEX_SHARE_CAP";
  constructor(message: string) {
    super(message);
    this.name = "PlexShareCapError";
  }
}
