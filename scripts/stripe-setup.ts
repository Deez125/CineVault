import "../lib/load-env";

import Stripe from "stripe";
import { stripe, isLiveMode, formatMoney } from "../lib/stripe/client";
import { TIER_PRODUCT_MARKER } from "../lib/stripe/tiers";
import { REFERRAL_COUPON_ID, REFEREE_PERCENT_OFF } from "../lib/referrals";

/**
 * Creates the CineVault product catalogue in Stripe.
 *
 *   npm run stripe:setup           # against whatever STRIPE_SECRET_KEY points at
 *   npm run stripe:setup -- --live # required to touch a live key
 *
 * Idempotent. Run it as many times as you like: it finds what already exists by metadata,
 * updates what drifted, and creates only what's missing.
 *
 * WHY THIS EXISTS
 *   Stripe's test and live modes are entirely separate datasets. Products, prices, customers,
 *   subscriptions and webhook endpoints do not sync between them, and the "copy to live mode"
 *   button in the dashboard mints new price ids anyway. Going live therefore means building
 *   the catalogue a second time, and doing that by hand at launch, against real money, is how
 *   you end up selling a $30 plan that grants one stream.
 *
 *   So: the catalogue is code. Run this once against the sandbox, once against live, and the
 *   two are identical by construction.
 *
 * THE IMPORTANT PART
 *   Each price carries `metadata.streams`. That is where a plan's concurrent-user count
 *   lives, and the app reads it from there. Nothing about tiers is hardcoded in the app and
 *   there are no price ids in the environment, so switching to live is one env var rather
 *   than five.
 */

type TierSpec = {
  streams: number;
  name: string;
  description: string;
  /** Minor units. 2000 = $20.00. */
  amount: number;
};

const CURRENCY = "usd";
const INTERVAL = "month" as const;

const TIERS: TierSpec[] = [
  {
    streams: 1,
    name: "1 User",
    description: "For one person. One thing playing at a time.",
    amount: 2000,
  },
  {
    streams: 2,
    name: "2 Users",
    description: "For a couple, or a small household.",
    amount: 3000,
  },
  {
    streams: 3,
    name: "3 Users",
    description: "For a household that watches separately.",
    amount: 4000,
  },
  {
    streams: 4,
    name: "4 Users",
    description: "For a full house, or a few friends.",
    amount: 5000,
  },
];

async function main() {
  const confirmedLive = process.argv.includes("--live");

  if (isLiveMode && !confirmedLive) {
    console.error(
      [
        "",
        "  REFUSING TO RUN: STRIPE_SECRET_KEY is a LIVE key.",
        "",
        "  This script creates products and prices that real customers will be charged",
        "  against. If you meant to do that, say so explicitly:",
        "",
        "      npm run stripe:setup -- --live",
        "",
      ].join("\n")
    );
    process.exit(1);
  }

  const mode = isLiveMode ? "LIVE" : "test";
  console.log(`\n  CineVault catalogue setup — ${mode} mode\n`);

  // Fetched ONCE, up front, and reused for every tier.
  //
  // This must be `list`, never `search`. Stripe's Search API is eventually consistent — an
  // object can take up to a minute to become searchable — so a search-based find-or-create
  // does not see what it just created and cheerfully makes a second one on every run. `list`
  // is immediately consistent.
  const allProducts = await stripe.products
    .list({ active: true, limit: 100 })
    .autoPagingToArray({ limit: 1000 });

  const results: { tier: TierSpec; productId: string; priceId: string; created: boolean }[] = [];

  for (const spec of TIERS) {
    const product = await ensureProduct(spec, allProducts);
    const { price, created } = await ensurePrice(product, spec);
    results.push({ tier: spec, productId: product.id, priceId: price.id, created });
  }

  await ensureReferralCoupon();
  await ensurePortalConfiguration();

  console.log("\n  Catalogue:\n");
  console.log("    streams  price          amount   id");
  for (const r of results) {
    console.log(
      `    ${String(r.tier.streams).padEnd(7)}  ${r.tier.name.padEnd(13)}  ` +
        `${formatMoney(r.tier.amount, CURRENCY).padEnd(7)}  ${r.priceId}${r.created ? "  (new)" : ""}`
    );
  }

  console.log(
    [
      "",
      "  Done. Nothing to copy into your environment: the app reads these from Stripe,",
      "  and each price carries its stream count in metadata.streams.",
      "",
      isLiveMode
        ? "  Live mode reminders: register the webhook endpoint, and add your domain under\n  Stripe -> Settings -> Payment method domains so Apple Pay and Google Pay appear.\n"
        : "  Next: point Stripe at your webhook so payments actually grant access.\n\n      stripe listen --forward-to localhost:3000/api/webhooks/stripe\n",
    ].join("\n")
  );
}

/**
 * Find-or-create the product for a tier, collapsing any duplicates.
 *
 * Matched on `metadata.streams`, not on name: renaming "2 Users" to "Duo" in the dashboard
 * should update the existing product, not silently create a second one and leave customers
 * spread across two products that mean the same thing.
 *
 * If several products claim the same tier, the OLDEST wins and the rest are archived. That
 * keeps the tier list unambiguous, and it self-heals a catalogue that a buggy earlier run (or
 * an afternoon in the dashboard) left with duplicates.
 */
async function ensureProduct(
  spec: TierSpec,
  allProducts: Stripe.Product[]
): Promise<Stripe.Product> {
  const matches = allProducts
    .filter(
      (p) =>
        p.metadata?.app === TIER_PRODUCT_MARKER &&
        p.metadata?.streams === String(spec.streams)
    )
    .sort((a, b) => a.created - b.created);

  if (matches.length === 0) {
    console.log(`  + creating product for ${spec.streams} user(s)`);
    return stripe.products.create({
      name: spec.name,
      description: spec.description,
      metadata: {
        app: TIER_PRODUCT_MARKER,
        streams: String(spec.streams),
      },
    });
  }

  const [keep, ...duplicates] = matches;

  for (const dupe of duplicates) {
    console.log(`  - archiving duplicate product ${dupe.id} for ${spec.streams} user(s)`);
    // Archive its prices first. An active price on an archived product is still usable in a
    // checkout, which would let someone subscribe to a tier we no longer list.
    const dupePrices = await stripe.prices.list({ product: dupe.id, active: true, limit: 100 });
    for (const price of dupePrices.data) {
      await stripe.prices.update(price.id, { active: false });
    }
    await stripe.products.update(dupe.id, { active: false });
  }

  const drifted = keep.name !== spec.name || (keep.description ?? "") !== spec.description;

  if (drifted) {
    console.log(`  ~ updating product for ${spec.streams} user(s)`);
    return stripe.products.update(keep.id, {
      name: spec.name,
      description: spec.description,
    });
  }

  console.log(`  = product for ${spec.streams} user(s) is up to date`);
  return keep;
}

/**
 * Find-or-create the price, and archive any stale ones.
 *
 * Stripe prices are IMMUTABLE — you cannot change an amount. Raising a price means creating a
 * new one and archiving the old. Archiving does not affect subscriptions already on it, which
 * is exactly what you want: existing customers keep the price they signed up at until you
 * migrate them deliberately.
 */
async function ensurePrice(
  product: Stripe.Product,
  spec: TierSpec
): Promise<{ price: Stripe.Price; created: boolean }> {
  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });

  const match = prices.data.find(
    (p) =>
      p.unit_amount === spec.amount &&
      p.currency === CURRENCY &&
      p.recurring?.interval === INTERVAL
  );

  if (match) {
    // The price is right but the metadata might not be — an older run, or a price made by
    // hand in the dashboard. Without metadata.streams the app cannot tell what it grants.
    if (match.metadata?.streams !== String(spec.streams)) {
      console.log(`  ~ repairing metadata.streams on ${match.id}`);
      const repaired = await stripe.prices.update(match.id, {
        metadata: { ...match.metadata, streams: String(spec.streams) },
      });
      return { price: repaired, created: false };
    }

    return { price: match, created: false };
  }

  console.log(
    `  + creating price ${formatMoney(spec.amount, CURRENCY)}/${INTERVAL} for ${spec.name}`
  );

  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: spec.amount,
    currency: CURRENCY,
    recurring: { interval: INTERVAL },
    metadata: { streams: String(spec.streams) },
  });

  // Archive superseded prices so the tier list has exactly one price per tier. Anyone
  // currently subscribed to an archived price keeps it and keeps being billed it.
  for (const stale of prices.data) {
    console.log(`  - archiving superseded price ${stale.id}`);
    await stripe.prices.update(stale.id, { active: false });
  }

  return { price, created: true };
}

/**
 * The coupon a referred friend gets on their first month.
 *
 * Created with an explicit `id` rather than a generated one, so the app can name it as a
 * constant instead of storing yet another id in the environment. A coupon's percentage is
 * immutable once created; if the offer ever changes, that means a new id, and the old coupon
 * stays valid for anyone mid-discount.
 */
async function ensureReferralCoupon() {
  try {
    const existing = await stripe.coupons.retrieve(REFERRAL_COUPON_ID);

    if (existing.percent_off !== REFEREE_PERCENT_OFF) {
      console.log(
        `  ! coupon ${REFERRAL_COUPON_ID} is ${existing.percent_off}% off, but the app expects ` +
          `${REFEREE_PERCENT_OFF}%. Stripe coupons are immutable — change REFERRAL_COUPON_ID in ` +
          `lib/referrals.ts to mint a new one.`
      );
    }

    return;
  } catch {
    // Not there yet.
  }

  console.log(`  + creating coupon ${REFERRAL_COUPON_ID} (${REFEREE_PERCENT_OFF}% off once)`);

  await stripe.coupons.create({
    id: REFERRAL_COUPON_ID,
    name: "Referred friend — first month",
    percent_off: REFEREE_PERCENT_OFF,
    // `once` is the whole offer: one discounted month, then the normal price. `repeating` or
    // `forever` here would quietly halve someone's plan for life.
    duration: "once",
  });
}

/**
 * The billing portal.
 *
 * Plan changes happen in our own UI, where we can show the real prorated cost before the
 * customer commits — Stripe's portal cannot do that, and a surprise charge is a support
 * ticket. So the portal is configured for the things it is genuinely better at: receipts,
 * invoice history, and updating a card.
 */
async function ensurePortalConfiguration(): Promise<void> {
  const existing = await stripe.billingPortal.configurations.list({ limit: 10 });
  const ours = existing.data.find((c) => c.metadata?.app === TIER_PRODUCT_MARKER);

  const settings: Stripe.BillingPortal.ConfigurationCreateParams = {
    business_profile: {
      headline: "CineVault billing",
    },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      customer_update: {
        enabled: true,
        allowed_updates: ["email", "address"],
      },
      // Cancelling is done in our UI, where we can explain that access continues to the end
      // of the period they already paid for. The portal just says "cancelled".
      subscription_cancel: { enabled: false },
    },
    metadata: { app: TIER_PRODUCT_MARKER },
  };

  if (ours) {
    console.log("  = billing portal configuration is up to date");
    await stripe.billingPortal.configurations.update(ours.id, settings);
    return;
  }

  console.log("  + creating billing portal configuration");
  await stripe.billingPortal.configurations.create(settings);
}

main().catch((err) => {
  console.error("\n  Setup failed:", err instanceof Error ? err.message : err, "\n");
  process.exit(1);
});
