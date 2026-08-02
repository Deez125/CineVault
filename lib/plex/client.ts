import { XMLParser } from "fast-xml-parser";
import { env, plexSectionIds } from "@/lib/env";

/**
 * plex.tv HTTP.
 *
 * Two things about this API that cost real time to discover, both verified against the live
 * server rather than taken from documentation:
 *
 *   - **The sharing endpoints speak XML, not JSON.** `/api/servers/{id}/shared_servers`
 *     returns `application/xml` no matter what you put in the Accept header. Only the
 *     `/api/v2/*` identity endpoints return JSON, and `/api/v2/shared_servers` answers 405 to
 *     a GET — it exists only to create shares.
 *
 *   - **Library KEYS are not plex.tv SECTION IDS.** A server reports
 *     `<Section id="143184126" key="11" title="Anime Movies"/>`. The share API wants the
 *     nine-digit `id`; almost everything else, including the env var inherited from the
 *     previous build, talks in the small `key`. Passing a key produces "404 Not found",
 *     worded as though the SERVER did not exist, which sends you debugging the wrong thing
 *     entirely. `resolveSectionIds()` below translates, and accepts either form.
 */

const PLEX_TV = "https://plex.tv";

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  // Plex returns one element unwrapped and several as an array. Without this, code that
  // works with two shared users crashes with one.
  isArray: (name) => ["SharedServer", "Section", "Server"].includes(name),
});

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
   * True when a 422 means the server has hit its share cap.
   *
   * This is the one that matters operationally: past the cap, EVERY new member silently
   * fails to be provisioned, one at a time, and it looks like an unrelated bug each time. It
   * has to be distinguishable from the harmless "already shared" 422, which is why the body
   * is read rather than the status trusted.
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

  /** True when a 422 just means the share already exists, which is our goal anyway. */
  get isAlreadyShared(): boolean {
    return this.status === 422 && !this.isShareCapReached;
  }
}

async function plexFetch(
  path: string,
  init: RequestInit & { token?: string | null } = {}
): Promise<Response> {
  const { token, ...rest } = init;

  const res = await fetch(`${PLEX_TV}${path}`, {
    ...rest,
    headers: { ...plexHeaders(token === undefined ? env.PLEX_TOKEN : token), ...(rest.headers ?? {}) },
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
  return (await plexFetch(path, init)).json() as Promise<T>;
}

async function plexXml<T>(path: string, init: RequestInit = {}): Promise<T> {
  const text = await (await plexFetch(path, init)).text();
  return xml.parse(text) as T;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Identity — the device PIN flow
// ═══════════════════════════════════════════════════════════════════════════════

export type PlexPin = { id: number; code: string };

/**
 * Mint a PIN to hand to Plex's hosted sign-in page.
 *
 * `strong: true` here, deliberately. The old warning against it applies to the OTHER flow:
 * if you are asking somebody to TYPE the code at plex.tv/link, it has to be the short
 * 4-character form, because the manual entry page will not accept a 25-character one. We are
 * not asking anyone to type anything — the code travels in a URL — so the long, higher
 * entropy form is strictly better.
 */
export async function createPin(): Promise<PlexPin> {
  const pin = await plexJson<{ id: number; code: string }>("/api/v2/pins", {
    method: "POST",
    token: null,
    body: new URLSearchParams({ strong: "true" }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  return { id: pin.id, code: pin.code };
}

/**
 * Where to send someone to sign in to Plex.
 *
 * Plex's hosted auth page. They sign in with their own credentials (or an existing session,
 * in which case it is one click), Plex attaches the result to the PIN, and it forwards them
 * back to us. We then redeem the PIN for a token.
 *
 * Note the `#?` — the parameters go in the FRAGMENT, not the query string. Plex's page reads
 * them client-side, and a normal `?` query silently produces a sign-in page that forgets
 * where it was supposed to send you afterwards.
 */
export function authUrl(code: string, forwardUrl: string): string {
  const params = new URLSearchParams({
    clientID: env.PLEX_CLIENT_IDENTIFIER ?? "",
    code,
    forwardUrl,
    "context[device][product]": "CineVault",
    "context[device][deviceName]": "CineVault",
    "context[device][platform]": "Web",
  });

  return `https://app.plex.tv/auth#?${params.toString()}`;
}

export type PlexIdentity = { id: string; username: string; email: string | null };

/**
 * Has the PIN been authorised yet?
 *
 * Returns null while the user hasn't finished. Once they have, Plex hands over THEIR token,
 * which we use exactly once to ask who they are and then discard. A member's Plex token is
 * never stored: we have no use for it, and keeping it would make this database far more
 * dangerous to lose.
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

  return { id: String(user.id), username: user.username, email: user.email ?? null };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Library sections
// ═══════════════════════════════════════════════════════════════════════════════

export type PlexSection = { id: string; key: string; title: string; type: string };

let sectionCache: { at: number; sections: PlexSection[] } | null = null;
const SECTION_TTL_MS = 10 * 60_000;

/** Every library on the server, with both its plex.tv id and its server-side key. */
export async function listSections(): Promise<PlexSection[]> {
  if (sectionCache && Date.now() - sectionCache.at < SECTION_TTL_MS) return sectionCache.sections;

  const parsed = await plexXml<{
    MediaContainer?: { Server?: Array<{ Section?: PlexSection[] }> };
  }>(`/api/servers/${env.PLEX_MACHINE_ID}`);

  const sections = (parsed.MediaContainer?.Server?.[0]?.Section ?? []).map((s) => ({
    id: String(s.id),
    key: String(s.key),
    title: String(s.title ?? ""),
    type: String(s.type ?? ""),
  }));

  sectionCache = { at: Date.now(), sections };
  return sections;
}

/**
 * The plex.tv section ids to share, translated from whatever PLEX_LIBRARY_SECTION_IDS holds.
 *
 * Accepts library keys OR section ids, because the value inherited from the previous
 * deployment is keys despite the variable's name, and silently sharing the wrong libraries
 * would be worse than either.
 *
 * Throws if anything can't be resolved. A share built from a partial list would grant a
 * paying member access to some of what they bought, and look like a success.
 */
export async function resolveSectionIds(): Promise<string[]> {
  const configured = plexSectionIds();
  if (configured.length === 0) {
    throw new Error("PLEX_LIBRARY_SECTION_IDS is empty; a share with no libraries is not a share");
  }

  const sections = await listSections();
  const byId = new Map(sections.map((s) => [s.id, s]));
  const byKey = new Map(sections.map((s) => [s.key, s]));

  const resolved: string[] = [];
  const missing: string[] = [];

  for (const value of configured) {
    const match = byId.get(value) ?? byKey.get(value);
    if (match) resolved.push(match.id);
    else missing.push(value);
  }

  if (missing.length > 0) {
    throw new Error(
      `PLEX_LIBRARY_SECTION_IDS refers to libraries that do not exist on this server: ` +
        `${missing.join(", ")}. Known libraries: ` +
        sections.map((s) => `${s.title} (key ${s.key}, id ${s.id})`).join("; ")
    );
  }

  return resolved;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sharing
// ═══════════════════════════════════════════════════════════════════════════════

export type SharedServer = { id: number; username: string | null; email: string | null };

/** Everyone the server is currently shared with. */
export async function listShares(): Promise<SharedServer[]> {
  const parsed = await plexXml<{
    MediaContainer?: {
      SharedServer?: Array<{ id: string; username?: string; email?: string }>;
    };
  }>(`/api/servers/${env.PLEX_MACHINE_ID}/shared_servers`);

  return (parsed.MediaContainer?.SharedServer ?? []).map((s) => ({
    id: Number(s.id),
    username: s.username ?? null,
    email: s.email ?? null,
  }));
}

/**
 * Share the configured libraries with a Plex account.
 *
 * "Already shared" counts as SUCCESS. This function's job is to make the share exist and it
 * already does; failing would make the reconciler retry forever and log an error every five
 * minutes about a member who is perfectly fine.
 */
export async function share(invitedEmailOrUsername: string): Promise<void> {
  const sectionIds = await resolveSectionIds();

  try {
    await plexFetch(`/api/servers/${env.PLEX_MACHINE_ID}/shared_servers`, {
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
        "Plex refused the share: the server has reached its user cap. Every new member will " +
          `fail to be provisioned until somebody is removed. Body: ${err.body}`
      );
    }

    throw err;
  }
}

/** Stop sharing. A share that doesn't exist is already the goal, so that is not an error. */
export async function unshare(usernameOrEmail: string): Promise<void> {
  const needle = usernameOrEmail.trim().toLowerCase();

  const shares = await listShares();
  const match = shares.find(
    (s) => s.username?.toLowerCase() === needle || s.email?.toLowerCase() === needle
  );

  if (!match) return;

  await plexFetch(`/api/servers/${env.PLEX_MACHINE_ID}/shared_servers/${match.id}`, {
    method: "DELETE",
  });
}

/**
 * Deliberately its own type: the share cap is not a per-member failure to log and retry, it
 * is a service-wide outage of new signups, and it needs to be visible as one.
 */
export class PlexShareCapError extends Error {
  readonly code = "PLEX_SHARE_CAP";
  constructor(message: string) {
    super(message);
    this.name = "PlexShareCapError";
  }
}
