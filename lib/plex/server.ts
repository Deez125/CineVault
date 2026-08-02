import { env } from "@/lib/env";
import { plexHeaders } from "./client";

/**
 * Talking to the Plex SERVER, as opposed to plex.tv.
 *
 * Two different APIs. plex.tv handles identity and sharing; the server itself holds the
 * libraries, the recently-added list and the artwork. We have no configured address for the
 * server and deliberately do not want one — asking plex.tv for its current connection URIs
 * means this keeps working when the machine moves, changes IP, or gets a new tunnel, with no
 * redeploy.
 */

type Resource = {
  clientIdentifier: string;
  provides: string;
  owned: boolean;
  accessToken?: string;
  connections?: { uri: string; local: boolean; relay: boolean; IPv6: boolean }[];
};

let cached: { uri: string; at: number } | null = null;
const TTL_MS = 10 * 60_000;

/**
 * A reachable base URL for the server.
 *
 * Connections are tried in the order Plex lists them minus the obviously worse ones: local
 * addresses are useless from a container that is not on that LAN, and relay connections are
 * Plex's slow fallback, so they go last rather than being picked first and making every
 * poster crawl.
 */
export async function serverUri(): Promise<string> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.uri;

  const res = await fetch("https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1", {
    headers: plexHeaders(env.PLEX_TOKEN),
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`could not list Plex resources: ${res.status}`);

  const resources = (await res.json()) as Resource[];
  const server = resources.find(
    (r) => r.clientIdentifier === env.PLEX_MACHINE_ID && r.provides.includes("server")
  );

  if (!server?.connections?.length) {
    throw new Error("Plex reports no connections for this server");
  }

  const candidates = [
    ...server.connections.filter((c) => !c.local && !c.relay && !c.IPv6),
    ...server.connections.filter((c) => !c.local && !c.relay),
    ...server.connections.filter((c) => c.relay),
  ];

  for (const connection of candidates) {
    try {
      // A cheap identity call rather than a HEAD: some connections answer the TCP handshake
      // and then fail on anything real, and a poster page that half-loads is worse than one
      // that picked a slower but working route.
      const probe = await fetch(`${connection.uri}/identity`, {
        headers: plexHeaders(env.PLEX_TOKEN),
        signal: AbortSignal.timeout(4000),
        cache: "no-store",
      });

      if (probe.ok) {
        cached = { uri: connection.uri, at: Date.now() };
        return connection.uri;
      }
    } catch {
      // Try the next one.
    }
  }

  throw new Error("no reachable Plex connection");
}

/** GET from the server, as JSON. */
export async function serverJson<T>(path: string): Promise<T> {
  const base = await serverUri();

  const res = await fetch(`${base}${path}`, {
    headers: { ...plexHeaders(env.PLEX_TOKEN), Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) throw new Error(`plex server ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

/** Forget the cached connection. Used when a request fails and the address may have moved. */
export function forgetServerUri(): void {
  cached = null;
}
