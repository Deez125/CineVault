/**
 * Money formatting, and nothing else.
 *
 * IMPORTS NOTHING, ON PURPOSE. This is used by client components, and the moment a module
 * like this pulls in something server-side the whole dependency comes with it into the
 * browser bundle. `formatMoney` used to live in lib/stripe/client.ts, which constructs a
 * Stripe instance — importing that from a "use client" file breaks the build with an error
 * about `dns` or `net` that says nothing about the real cause.
 *
 * Amounts are MINOR UNITS everywhere in this codebase (2000 = $20.00), because storing money
 * as a float is how you end up billing somebody $19.999999998.
 */

/** 2000 -> "$20", 1750 -> "$17.50". Whole amounts lose the trailing ".00". */
export function formatMoney(minorUnits: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: minorUnits % 100 === 0 ? 0 : 2,
  }).format(minorUnits / 100);
}
