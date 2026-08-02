import Stripe from "stripe";
import { env } from "@/lib/env";

// Deliberately NOT marked `server-only`: the background worker imports this too, and it runs
// in plain Node where that package throws. The secret is protected by the fact that nothing
// under a "use client" boundary imports this — if something did, Next would fail the build on
// the Node built-ins Stripe pulls in, long before the key could reach a browser.

/**
 * The Stripe client.
 *
 * Server-side only, always. The secret key can read every customer and cancel every
 * subscription; it must never be bundled into anything the browser downloads. The browser
 * gets the PUBLISHABLE key, which can only create payments.
 */
export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  // Pinned deliberately. Stripe rolls the API forward and an unpinned client can start
  // receiving a differently-shaped object after a library upgrade, in the webhook, in
  // production, on a Sunday.
  apiVersion: "2026-07-29.dahlia",
  appInfo: { name: "CineVault", version: "0.1.0" },
  // Network blips shouldn't fail a checkout. Stripe's client retries idempotently.
  maxNetworkRetries: 2,
  timeout: 20_000,
});

/** True when we're pointed at a live key. Used to refuse destructive scripted operations. */
export const isLiveMode = env.STRIPE_SECRET_KEY.startsWith("sk_live_");

/**
 * Statuses that entitle someone to access.
 *
 * `past_due` is included on purpose: a card that failed at 3am should not lock someone out
 * before Stripe has finished its retry schedule. They keep watching while Stripe retries, and
 * they lose access only when the subscription actually moves to `canceled` or `unpaid`.
 * Losing a day of revenue to a retry is cheaper than a support ticket and a churn.
 */
const ENTITLING = new Set(["active", "trialing", "past_due"]);

export function isEntitling(status: string | null | undefined): boolean {
  return Boolean(status && ENTITLING.has(status));
}

/** Format minor units for display. 2000 -> "$20", 1750 -> "$17.50". */
export function formatMoney(minorUnits: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: minorUnits % 100 === 0 ? 0 : 2,
  }).format(minorUnits / 100);
}
