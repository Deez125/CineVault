import "../lib/load-env";

import { getTiers } from "../lib/stripe/tiers";
import { formatMoney, isLiveMode } from "../lib/stripe/client";

/**
 * Prints the plan catalogue exactly as the app sees it.
 *
 *   npx tsx scripts/stripe-tiers.ts
 *
 * Useful when the pricing page looks wrong: it tells you whether the problem is the app or
 * the Stripe catalogue, which are the only two possibilities and are otherwise hard to tell
 * apart from a blank page.
 */
async function main() {
  const tiers = await getTiers();

  console.log(`\n  ${isLiveMode ? "LIVE" : "test"} mode — ${tiers.length} tier(s)\n`);

  if (tiers.length === 0) {
    console.log("  Nothing. Run `npm run stripe:setup` to create the catalogue.\n");
    return;
  }

  for (const t of tiers) {
    console.log(
      `  ${t.streams} user(s)  ${t.label.padEnd(10)} ${formatMoney(t.amount, t.currency).padEnd(6)}/${t.interval}  ${t.priceId}`
    );
    console.log(`             ${t.blurb}`);
  }
  console.log("");
}

main().catch((err) => {
  console.error("failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
