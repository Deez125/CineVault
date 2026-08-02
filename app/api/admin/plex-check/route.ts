import { apiAdmin } from "@/lib/auth";
import { plexConfigured, plexSectionIds, protectedPlexUsers } from "@/lib/env";
import { listSections, listShares, plexJson, resolveSectionIds } from "@/lib/plex/client";

/**
 * A live health check against Plex. Read only.
 *
 * The same thing `npm run plex:check` does, in the panel, so a Plex problem can be diagnosed
 * without shell access. Nothing here writes.
 */
export async function GET() {
  const auth = await apiAdmin();
  if (!auth.ok) return auth.response;

  if (!plexConfigured()) {
    return Response.json({ configured: false });
  }

  try {
    const [owner, sections, shares, resolvedIds] = await Promise.all([
      plexJson<{ username: string; email: string }>("/api/v2/user"),
      listSections(),
      listShares(),
      resolveSectionIds(),
    ]);

    const shared = new Set(resolvedIds);
    const guarded = protectedPlexUsers();

    return Response.json({
      configured: true,
      owner: { username: owner.username, email: owner.email },
      libraries: {
        shared: sections.filter((s) => shared.has(s.id)).map((s) => s.title),
        excluded: sections.filter((s) => !shared.has(s.id)).map((s) => s.title),
      },
      // The env var is named for section ids but historically holds library KEYS. Showing
      // both makes it obvious which is which when something does not line up.
      configuredValues: plexSectionIds(),
      resolvedIds,
      shares: shares.map((s) => ({
        name: s.username ?? s.email ?? String(s.id),
        protected: guarded.includes((s.username ?? "").toLowerCase()),
      })),
      protectedUsers: guarded,
    });
  } catch (err) {
    return Response.json({
      configured: true,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
