import "../lib/load-env";

import { env, plexConfigured, plexSectionIds, protectedPlexUsers } from "../lib/env";
import { listSections, listShares, plexJson, resolveSectionIds } from "../lib/plex/client";

/**
 * Read-only Plex health check.
 *
 *   npm run plex:check
 *
 * Confirms the owner token works, the machine id resolves to a real server, the configured
 * section ids exist on it, and the share list is readable. Touches nothing.
 *
 * The section-id check is the point of this script. Plex reports library KEYS in one place
 * and plex.tv SECTION IDS in another, they are different numbers, and passing a key to the
 * share API fails with "404 Not found" — worded as though the SERVER did not exist, which
 * sends you debugging entirely the wrong thing for an hour.
 */
async function main() {
  if (!plexConfigured()) {
    console.error("\n  Plex is not configured. Set PLEX_TOKEN, PLEX_MACHINE_ID, " +
      "PLEX_LIBRARY_SECTION_IDS and PLEX_CLIENT_IDENTIFIER.\n");
    process.exit(1);
  }

  console.log("\n  Plex check\n");

  // 1. Does the owner token work at all?
  const me = await plexJson<{ username: string; email: string }>("/api/v2/user");
  console.log(`  token      ok, owner is ${me.username} <${me.email}>`);

  // 2. Do we know this server, and what sections does plex.tv think it has?
  const servers = await plexJson<
    Array<{ clientIdentifier: string; name: string; owned: boolean }>
  >("/api/v2/resources?includeHttps=1");

  const server = servers.find((s) => s.clientIdentifier === env.PLEX_MACHINE_ID);
  if (!server) {
    console.error(
      `\n  machine id ${env.PLEX_MACHINE_ID} is not in this account's resources.\n` +
        `  Found: ${servers.filter((s) => s.owned).map((s) => `${s.name} (${s.clientIdentifier})`).join(", ") || "none owned"}\n`
    );
    process.exit(1);
  }
  console.log(`  server     ok, "${server.name}"${server.owned ? " (owned)" : " (NOT OWNED — sharing will fail)"}`);

  // 3. The share list. An unreadable list would read as "nobody is shared with", which is
  //    the input the reconciler uses to decide who needs re-inviting.
  const shares = await listShares();
  console.log(`  shares     ok, ${shares.length} account(s) currently shared with`);

  // 4. Configured libraries, and their translation to plex.tv section ids.
  //
  // This is the reason this script exists. PLEX_LIBRARY_SECTION_IDS holds library KEYS
  // despite its name, and passing a key to the share API fails with "404 Not found" as
  // though the SERVER did not exist.
  const configured = plexSectionIds();
  const resolved = await resolveSectionIds();
  const sections = await listSections();

  console.log(`  libraries  ${resolved.length}/${sections.length} shared`);
  for (const value of configured) {
    const s = sections.find((x) => x.key === value || x.id === value);
    console.log(`               key ${String(s?.key).padEnd(3)} -> id ${s?.id}  ${s?.title}`);
  }

  const excluded = sections.filter((s) => !resolved.includes(s.id));
  if (excluded.length > 0) {
    console.log(`  NOT shared ${excluded.map((s) => s.title).join(", ")}`);
  }

  // 5. The hard rail, and whether the people on it are actually shared with.
  const guarded = protectedPlexUsers();
  const shareNames = new Set(
    shares.flatMap((s) => [s.username?.toLowerCase(), s.email?.toLowerCase()].filter(Boolean))
  );
  const guardedPresent = guarded.filter((u) => shareNames.has(u));

  console.log(`  protected  ${guarded.length} account(s), ${guardedPresent.length} of them currently shared`);

  if (shares.length > 0) {
    console.log("\n  Currently shared with:");
    for (const s of shares) {
      const name = s.username ?? s.email ?? `#${s.id}`;
      const isGuarded = guarded.includes((s.username ?? "").toLowerCase());
      console.log(`    ${isGuarded ? "[protected]" : "           "} ${name}`);
    }
  }

  console.log("");
}

main().catch((err) => {
  console.error("\n  Plex check FAILED:", err instanceof Error ? err.message : err);
  if (err && typeof err === "object" && "body" in err) {
    console.error("  body:", String((err as { body: string }).body).slice(0, 500));
  }
  console.error("");
  process.exit(1);
});
