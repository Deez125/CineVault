import crypto from "node:crypto";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { referrals, users, type Referral, type User } from "@/lib/db/schema";
import { logEvent, logError } from "@/lib/events";
import { stripe } from "@/lib/stripe/client";

/**
 * Referrals.
 *
 * Refer somebody and you get $10 off your next bill, whatever plan you are on. They get 50%
 * off their first month, whatever plan they pick.
 *
 * The two halves are deliberately different shapes. A flat credit for the referrer is
 * predictable and easy to say out loud; a percentage for the referee is worth more on the
 * bigger plans, which is where you want the encouragement.
 *
 * Nothing pays out until the referee's first payment actually succeeds. A signup is not a
 * customer, and paying for signups is paying for email addresses.
 */

/** Credit to the referrer, in minor units. Flat, regardless of either party's plan. */
export const REFERRAL_REWARD = 1000;
export const REFERRAL_CURRENCY = "usd";

/** What the referee gets off their first month. */
export const REFEREE_PERCENT_OFF = 50;

/**
 * Rewarded referrals per referrer per calendar month.
 *
 * Not a limit on how many people they may refer — a limit on how many they get PAID for. The
 * cap is what stops one person turning the scheme into an income, and three is enough that a
 * genuine enthusiast never notices it.
 */
export const MONTHLY_REWARD_CAP = 3;

/** The Stripe coupon created by `npm run stripe:setup`. */
export const REFERRAL_COUPON_ID = "cinevault-referral-first-month";

/**
 * Code alphabet.
 *
 * No O/0, I/1/L. These codes get read aloud and typed from screenshots, and a code that is
 * ambiguous in either direction generates a support ticket rather than a signup.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

function newCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) code += ALPHABET[bytes[i] % ALPHABET.length];
  return code;
}

/**
 * This user's code, minting one the first time it is asked for.
 *
 * Retries on collision rather than trusting randomness: 31^8 is a big space, but "big enough
 * that it will not happen" is how you get a duplicate in production.
 */
export async function getOrCreateCode(userId: string): Promise<string> {
  const [existing] = await db
    .select({ code: users.referralCode })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (existing?.code) return existing.code;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newCode();

    try {
      await db
        .update(users)
        .set({ referralCode: code, updatedAt: new Date() })
        .where(eq(users.id, userId));

      return code;
    } catch {
      // Unique violation on the code. Try another.
    }
  }

  throw new Error("could not generate a referral code");
}

/** Who owns this code, or null. Case-insensitive, because people retype them. */
export async function findByCode(code: string): Promise<User | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;

  const [user] = await db
    .select()
    .from(users)
    .where(sql`upper(${users.referralCode}) = upper(${trimmed})`)
    .limit(1);

  return user ?? null;
}

/**
 * Attach a new signup to whoever referred them.
 *
 * Called at signup, and it never throws — a bad or expired code must not stop somebody
 * creating an account. The worst outcome of an unrecognised code is that nobody gets paid.
 */
export async function attachReferral(
  newUser: Pick<User, "id" | "email">,
  code: string | null
): Promise<void> {
  if (!code) return;

  try {
    const referrer = await findByCode(code);

    // Self-referral through your own code is the one case worth blocking outright: it is not
    // a referral, it is a discount you wrote yourself.
    if (!referrer || referrer.id === newUser.id) return;

    await db
      .update(users)
      .set({ referredBy: referrer.id, updatedAt: new Date() })
      .where(eq(users.id, newUser.id));

    await db.insert(referrals).values({
      referrerId: referrer.id,
      referrerEmail: referrer.email,
      refereeId: newUser.id,
      refereeEmail: newUser.email,
      code: code.trim().toUpperCase(),
      status: "pending",
    });
  } catch (err) {
    await logError(
      "could not attach referral",
      { error: err instanceof Error ? err.message : String(err), code },
      { userId: newUser.id, email: newUser.email, actor: "user" }
    );
  }
}

/** True when this user should get the first-month discount at checkout. */
export async function shouldDiscount(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ status: referrals.status })
    .from(referrals)
    .where(eq(referrals.refereeId, userId))
    .limit(1);

  // Only while it is still pending. Once it has paid out they have had their first month.
  return row?.status === "pending";
}

/**
 * Pay the referrer, if this user was referred and has just paid for the first time.
 *
 * Called from the Stripe webhook on a successful payment. Safe to call repeatedly: the
 * referral only moves out of `pending` once, so a redelivered webhook cannot pay twice.
 */
export async function rewardForFirstPayment(refereeId: string): Promise<void> {
  const [referral] = await db
    .select()
    .from(referrals)
    .where(and(eq(referrals.refereeId, refereeId), eq(referrals.status, "pending")))
    .limit(1);

  if (!referral?.referrerId) return;

  const [referrer] = await db
    .select()
    .from(users)
    .where(eq(users.id, referral.referrerId))
    .limit(1);

  if (!referrer) return;

  // The cap is counted from the LEDGER, not from a column on the user, so it is a fact about
  // what was actually paid rather than a counter that could drift.
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [{ n }] = await db
    .select({ n: count() })
    .from(referrals)
    .where(
      and(
        eq(referrals.referrerId, referrer.id),
        eq(referrals.status, "rewarded"),
        gte(referrals.rewardedAt, monthStart)
      )
    );

  if (n >= MONTHLY_REWARD_CAP) {
    await db
      .update(referrals)
      .set({ status: "capped", rewardedAt: new Date() })
      .where(eq(referrals.id, referral.id));

    await logEvent({
      type: "admin_action",
      actor: "webhook",
      userId: referrer.id,
      email: referrer.email,
      message: `${referrer.email} referred ${referral.refereeEmail} but is at this month's cap`,
      detail: { referralId: referral.id, cap: MONTHLY_REWARD_CAP },
    });

    return;
  }

  if (!referrer.stripeCustomerId) {
    // Nothing to credit against yet. Left pending so it pays out if they ever subscribe.
    return;
  }

  try {
    // A NEGATIVE balance transaction is a credit in Stripe: the customer balance is what they
    // owe, so reducing it is money off. Positive would bill them for referring somebody.
    await stripe.customers.createBalanceTransaction(referrer.stripeCustomerId, {
      amount: -REFERRAL_REWARD,
      currency: REFERRAL_CURRENCY,
      description: `Referral credit — ${referral.refereeEmail}`,
    });

    await db
      .update(referrals)
      .set({
        status: "rewarded",
        rewardAmount: REFERRAL_REWARD,
        rewardCurrency: REFERRAL_CURRENCY,
        rewardedAt: new Date(),
      })
      .where(eq(referrals.id, referral.id));

    await logEvent({
      type: "admin_action",
      actor: "webhook",
      userId: referrer.id,
      email: referrer.email,
      message: `${referrer.email} earned a referral credit for ${referral.refereeEmail}`,
      detail: { referralId: referral.id, amount: REFERRAL_REWARD, currency: REFERRAL_CURRENCY },
    });
  } catch (err) {
    // Left pending on purpose, so a Stripe blip becomes a retry rather than a lost reward.
    await logError(
      "could not credit referrer",
      { error: err instanceof Error ? err.message : String(err), referralId: referral.id },
      { userId: referrer.id, email: referrer.email, actor: "webhook" }
    );
  }
}

export type ReferralSummary = {
  code: string;
  /** Signed up, not yet paid. */
  pending: number;
  rewarded: number;
  capped: number;
  /** Total credited, in minor units. */
  earned: number;
  currency: string;
  /** How many more will pay out this calendar month. */
  remainingThisMonth: number;
  recent: Referral[];
};

export async function getSummary(user: Pick<User, "id">): Promise<ReferralSummary> {
  const code = await getOrCreateCode(user.id);

  const rows = await db
    .select()
    .from(referrals)
    .where(eq(referrals.referrerId, user.id))
    .orderBy(desc(referrals.createdAt))
    .limit(50);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const rewardedThisMonth = rows.filter(
    (r) => r.status === "rewarded" && r.rewardedAt && r.rewardedAt >= monthStart
  ).length;

  return {
    code,
    pending: rows.filter((r) => r.status === "pending").length,
    rewarded: rows.filter((r) => r.status === "rewarded").length,
    capped: rows.filter((r) => r.status === "capped").length,
    earned: rows.reduce((total, r) => total + (r.rewardAmount ?? 0), 0),
    currency: REFERRAL_CURRENCY,
    remainingThisMonth: Math.max(0, MONTHLY_REWARD_CAP - rewardedThisMonth),
    recent: rows.slice(0, 10),
  };
}
