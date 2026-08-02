import { stripe } from "./client";

/**
 * The plans, read from Stripe.
 *
 * The stream count for a plan lives in the PRICE'S METADATA (`metadata.streams`), written by
 * `npm run stripe:setup`. Nothing here is hardcoded and there are no STRIPE_PRICE_1..4 env
 * vars.
 *
 * That is a deliberate change from the previous build, which kept four price ids in the
 * environment and verified them at boot. Every one of those is a value that can drift between
 * test and live, and going live meant editing four variables and hoping. Now the price
 * carries its own meaning: whatever mode the secret key points at, the tiers come back
 * correct, and switching to live is one env var.
 */

export type Tier = {
  priceId: string;
  productId: string;
  /** Concurrent users this plan allows. */
  streams: number;
  label: string;
  blurb: string;
  /** Minor units. 2000 = $20.00. */
  amount: number;
  currency: string;
  /** "month" | "year" */
  interval: string;
};

/** Marks a Stripe product as one of ours, so unrelated products in the account are ignored. */
export const TIER_PRODUCT_MARKER = "cinevault_tier";

const CACHE_TTL_MS = 60_000;
let cache: { at: number; tiers: Tier[] } | null = null;

/**
 * Every active CineVault tier, cheapest first.
 *
 * Cached for a minute. The pricing page is the most-hit route on the site and the tiers change
 * about twice a year; hitting Stripe on every render would add a round trip to every visit
 * and eventually rate-limit us for no benefit.
 */
export async function getTiers(): Promise<Tier[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.tiers;

  const prices = await stripe.prices.list({
    active: true,
    expand: ["data.product"],
    limit: 100,
  });

  const tiers: Tier[] = [];

  for (const price of prices.data) {
    const product = price.product;

    // Deleted products come back as a bare id string, and a deleted product's price should
    // not be sellable.
    if (typeof product === "string" || product.deleted) continue;
    if (product.metadata?.app !== TIER_PRODUCT_MARKER) continue;
    if (!price.recurring || price.unit_amount == null) continue;

    const streams = Number(price.metadata?.streams);
    if (!Number.isInteger(streams) || streams < 1) {
      // A tier price with no stream count would silently entitle nobody to anything. Loud in
      // the logs, skipped in the list, rather than sold and then not honoured.
      console.error(
        `[tiers] price ${price.id} is marked as a CineVault tier but has no valid metadata.streams — skipping`
      );
      continue;
    }

    tiers.push({
      priceId: price.id,
      productId: product.id,
      streams,
      label: product.name,
      blurb: product.description ?? "",
      amount: price.unit_amount,
      currency: price.currency,
      interval: price.recurring.interval,
    });
  }

  tiers.sort((a, b) => a.streams - b.streams);
  cache = { at: Date.now(), tiers };
  return tiers;
}

/** The tier a price id refers to, or null if it isn't one of ours. */
export async function tierForPrice(priceId: string | null | undefined): Promise<Tier | null> {
  if (!priceId) return null;
  const tiers = await getTiers();
  return tiers.find((t) => t.priceId === priceId) ?? null;
}

/**
 * How many concurrent users a price entitles.
 *
 * Falls back to reading the price directly from Stripe when it isn't in the cached tier list
 * — a subscription on a since-archived price still has to be honoured, and returning 0 for it
 * would revoke a paying customer at the next reconcile.
 */
export async function streamsForPrice(priceId: string | null | undefined): Promise<number> {
  if (!priceId) return 0;

  const known = await tierForPrice(priceId);
  if (known) return known.streams;

  try {
    const price = await stripe.prices.retrieve(priceId);
    const streams = Number(price.metadata?.streams);
    return Number.isInteger(streams) && streams > 0 ? streams : 0;
  } catch {
    return 0;
  }
}

/** Drop the cache. Called by the setup script after it changes the catalogue. */
export function invalidateTierCache(): void {
  cache = null;
}
