import type Stripe from "stripe";
import { stripe } from "@/lib/stripe/client";
import { formatMoney } from "@/lib/money";
import { logEvent } from "@/lib/events";
import { createUserNotification } from "@/lib/notifications";
import { AdminActionError } from "@/lib/admin-actions";
import type { User } from "@/lib/db/schema";

/**
 * The credit-shaped admin actions for a single user.
 *
 * Discount (attach a Stripe coupon to the sub) was tried and reverted — coupons on an
 * already-active subscription didn't attach reliably against this API pin, and the UI +
 * server code was removed to avoid buttons for a dead code path. Credit is the equivalent
 * remedy (award $X, Stripe applies it against the next invoice), and it's trivially
 * calculable without any coupon machinery.
 *
 * Rails:
 *   - Every action writes to STRIPE (not our own `users` row) — Stripe is the source of
 *     truth. The reconciler picks the change up on its next pass.
 *   - Every action logs an event (admin_action type) with the admin as actor.
 *   - Every action fires a notification on the target user's dashboard so they can see
 *     what just happened to their account.
 */

type Ctx = { adminId: string; adminEmail: string };
const actorOf = (ctx: Ctx) => `admin:${ctx.adminId}` as const;

const CREDIT_KIND = { kind: "admin_credit" } as const;

// ── award a fixed amount of credit ─────────────────────────────────────────

/**
 * Add credit to a user's Stripe balance. Amount is in CENTS.
 *
 * "Credit" in Stripe is a negative customer balance — the balance represents money owed, so
 * making it more negative means the customer owes less on their next invoice. This helper
 * always adds credit (never charges); to charge, admin would use adminSetCredit with a lower
 * absolute value.
 *
 * `reason` becomes the balance transaction description and gets echoed into the notification
 * the user sees. If it's blank the notification just says "Credit added to your account."
 */
export async function adminAwardCredit(
  user: User,
  amountCents: number,
  reason: string | null,
  ctx: Ctx
): Promise<{ balanceCentsAfter: number }> {
  if (!user.stripeCustomerId) {
    throw new AdminActionError("This user has no Stripe customer to credit.");
  }
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new AdminActionError("Credit amount must be a positive number.");
  }
  if (amountCents > 100_000_00) {
    // $100k sanity ceiling on a single action. Bigger corrections belong in Stripe directly.
    throw new AdminActionError("That amount looks wrong. Cap is $100,000 per action.");
  }

  const trimmedReason = reason?.trim() || null;
  const description = trimmedReason
    ? `Credit awarded by admin — ${trimmedReason}`
    : "Credit awarded by admin";

  // Reason stashed in metadata as well as the description so the billing ledger can render
  // a clean "Credit awarded by admin — {reason}" without parsing the description string.
  await stripe.customers.createBalanceTransaction(user.stripeCustomerId, {
    amount: -amountCents,
    currency: (user.subCurrency ?? "usd").toLowerCase(),
    description,
    metadata: {
      ...CREDIT_KIND,
      admin_id: ctx.adminId,
      ...(trimmedReason ? { reason: trimmedReason } : {}),
    },
  });

  const after = await fetchCustomerCreditCents(user.stripeCustomerId);

  await logEvent({
    type: "admin_action",
    severity: "info",
    actor: actorOf(ctx),
    userId: user.id,
    email: user.email,
    message: `admin ${ctx.adminEmail} credited ${user.email} ${formatMoney(amountCents)}`,
    detail: { amountCents, reason: trimmedReason, balanceCentsAfter: after },
  });

  await createUserNotification({
    userId: user.id,
    kind: "credit_awarded",
    title: `${formatMoney(amountCents)} added to your account`,
    body: trimmedReason ?? "It'll come off your next bill automatically.",
    severity: "success",
  });

  return { balanceCentsAfter: after };
}

// ── overwrite credit balance to a specific amount ──────────────────────────

/**
 * Set the customer's credit balance to an exact amount (in CENTS, positive = credit).
 *
 * This is the "fix a glitch" path: if the code double-credited someone, or a webhook
 * misfired, the admin can just say "the correct balance is $X" and this delta-corrects to
 * match by writing one balance transaction for whatever difference is needed.
 *
 * Setting to ZERO wipes their credit — worth a confirmation in the UI.
 */
export async function adminSetCredit(
  user: User,
  absoluteCents: number,
  reason: string | null,
  ctx: Ctx
): Promise<{ balanceCentsAfter: number; deltaCents: number }> {
  if (!user.stripeCustomerId) {
    throw new AdminActionError("This user has no Stripe customer to adjust.");
  }
  if (!Number.isFinite(absoluteCents) || absoluteCents < 0) {
    throw new AdminActionError("Credit balance must be zero or positive.");
  }

  const current = await fetchCustomerCreditCents(user.stripeCustomerId);
  const delta = absoluteCents - current;

  if (delta === 0) {
    return { balanceCentsAfter: current, deltaCents: 0 };
  }

  const trimmedReason = reason?.trim() || null;
  // The label the user sees flips on delta sign, so pre-compute it here — parsing back from
  // "Admin balance adjustment" would lose the direction.
  const action = delta > 0 ? "Credit awarded by admin" : "Credit removed by admin";
  const description = trimmedReason ? `${action} — ${trimmedReason}` : action;

  // Positive delta → add credit (negative balance txn).
  // Negative delta → reduce credit (positive balance txn charges the account).
  await stripe.customers.createBalanceTransaction(user.stripeCustomerId, {
    amount: -delta,
    currency: (user.subCurrency ?? "usd").toLowerCase(),
    description,
    metadata: {
      ...CREDIT_KIND,
      admin_id: ctx.adminId,
      adjustment: "set-to-absolute",
      ...(trimmedReason ? { reason: trimmedReason } : {}),
    },
  });

  const after = await fetchCustomerCreditCents(user.stripeCustomerId);

  await logEvent({
    type: "admin_action",
    severity: "warn",
    actor: actorOf(ctx),
    userId: user.id,
    email: user.email,
    message:
      `admin ${ctx.adminEmail} set ${user.email} credit balance to ${formatMoney(absoluteCents)}` +
      ` (was ${formatMoney(current)})`,
    detail: {
      absoluteCents,
      deltaCents: delta,
      balanceCentsBefore: current,
      balanceCentsAfter: after,
      reason: trimmedReason,
    },
  });

  // Only notify the user when their available money changed for the better. A downward
  // correction is usually a bug fix and not something to blast at them; the audit log
  // still captures it either way.
  if (delta > 0) {
    await createUserNotification({
      userId: user.id,
      kind: "credit_adjusted",
      title: `Your credit balance is now ${formatMoney(absoluteCents)}`,
      body: trimmedReason ?? undefined,
      severity: "success",
    });
  }

  return { balanceCentsAfter: after, deltaCents: delta };
}

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Current credit sitting on the customer's Stripe balance, in cents (positive = credit).
 *
 * Stripe stores `balance` as: negative means the customer has credit; positive means they
 * owe. We invert so "credit balance" is a positive number everywhere in our UI.
 */
export async function fetchCustomerCreditCents(customerId: string): Promise<number> {
  const cust = await stripe.customers.retrieve(customerId);
  if (cust.deleted) return 0;
  const balance = (cust as Stripe.Customer).balance ?? 0;
  return balance < 0 ? -balance : 0;
}
