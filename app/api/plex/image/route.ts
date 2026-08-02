import { apiUser } from "@/lib/auth";
import { env, plexConfigured } from "@/lib/env";
import { plexHeaders } from "@/lib/plex/client";
import { forgetServerUri, serverUri } from "@/lib/plex/server";

/**
 * Serves Plex artwork without handing out the Plex token.
 *
 * A Plex image URL carries `X-Plex-Token`, and that token grants FULL access to the server —
 * every library, every user, the ability to unshare anybody. Putting one in an `<img src>`
 * gives it to every browser that loads the page and to anything reading the HTML. So the
 * browser asks us, and we fetch it server-side with the token attached.
 *
 * Which makes this an open proxy unless it is fenced, so it is fenced twice: only signed-in
 * people may call it, and only paths that look like Plex artwork are allowed through.
 */

/**
 * Artwork paths, and nothing else.
 *
 * Without this the `path` parameter would let anybody with an account make our server fetch
 * arbitrary URLs with an admin token attached — reading the library list, or worse, hitting
 * endpoints that change things. An allowlist of shapes is the only safe way to take a path
 * from a client.
 */
const ALLOWED = [
  /^\/library\/metadata\/\d+\/(thumb|art|poster)\/\d+$/,
  /^\/library\/parts\/\d+\/\d+\/thumb$/,
];

export async function GET(request: Request) {
  const auth = await apiUser();
  if (!auth.ok) return auth.response;

  if (!plexConfigured()) return new Response(null, { status: 404 });

  const url = new URL(request.url);
  const path = url.searchParams.get("path");
  const width = Number(url.searchParams.get("w") ?? 300);

  if (!path || !ALLOWED.some((pattern) => pattern.test(path))) {
    return new Response(null, { status: 400 });
  }

  // Bounded, so nobody can ask the server to render a 20000px poster and tie it up.
  const w = Math.min(Math.max(Number.isFinite(width) ? width : 300, 60), 900);
  const h = Math.round(w * 1.5);

  try {
    const base = await serverUri();

    // Plex's own transcoder, so we serve a poster-sized image rather than the full-resolution
    // original for a thumbnail.
    const transcode =
      `${base}/photo/:/transcode?width=${w}&height=${h}&minSize=1&upscale=1` +
      `&url=${encodeURIComponent(path)}`;

    const upstream = await fetch(transcode, {
      headers: plexHeaders(env.PLEX_TOKEN),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });

    if (!upstream.ok || !upstream.body) {
      return new Response(null, { status: 502 });
    }

    return new Response(upstream.body, {
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "image/jpeg",
        // Posters do not change. Cached privately rather than publicly: this URL is only
        // meaningful to somebody signed in, and a shared cache should not hold it.
        "cache-control": "private, max-age=86400, immutable",
      },
    });
  } catch {
    // The address may have moved. Drop it so the next request re-resolves.
    forgetServerUri();
    return new Response(null, { status: 502 });
  }
}
