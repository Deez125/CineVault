import crypto from "node:crypto";
import { and, count, desc, eq, gte, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  referralLinks,
  referrals,
  users,
  type Referral,
  type ReferralLink,
  type User,
} from "@/lib/db/schema";
import { logEvent, logError } from "@/lib/events";
import { stripe } from "@/lib/stripe/client";

/**
 * Referrals.
 *
 * A member mints an invite link. Somebody signs up with it and gets 50% off their first
 * month; once that first payment actually clears, $5 comes off the member's next bill.
 *
 * The two halves are deliberately different shapes. A flat credit for the referrer is
 * predictable and easy to say out loud; a percentage for the referee is worth more on the
 * bigger plans, which is where you want the encouragement.
 *
 * WHY LINKS RATHER THAN A PERMANENT CODE
 *   A code that never changes is a code that ends up on a deals forum. Minting invites one at
 *   a time, against a monthly allowance, keeps the scheme personal: the member can see what
 *   became of each one, and the most any single leak can cost is one slot.
 *
 * WHERE THE MONTHLY LIMIT IS SPENT
 *   At GENERATION, not at payout. Pressing the button is what costs a slot. Revoking or
 *   letting one expire gives it back, so nobody is locked out for a month because a friend
 *   said "maybe later" — but they cannot paper the internet with links either.
 *
 * WHAT NEVER CHANGES
 *   Nothing pays out until the referee's first payment succeeds. A signup is not a customer,
 *   and paying for signups is paying for email addresses.
 */

/** Credit to the referrer, in minor units. Flat, regardless of either party's plan. */
export const REFERRAL_REWARD = 500;
export const REFERRAL_CURRENCY = "usd";

/** What the referee gets off their first month. */
export const REFEREE_PERCENT_OFF = 50;

/**
 * Invite links a member may have outstanding per calendar month.
 *
 * Counted against links CREATED this month that are still alive or already used. Revoked and
 * expired ones do not count, which is what makes the allowance forgiving rather than a trap.
 */
export const MONTHLY_LINK_CAP = 3;

/** How long a fresh link stays usable. */
export const LINK_LIFETIME_DAYS = 30;

/**
 * How long a DEAD-AND-UNUSED link stays on the page before it is deleted.
 *
 * Only ever applies to invites nobody redeemed — expired or revoked. A used link is a record
 * of a real referral and is kept forever, whatever its age and whatever became of the credit,
 * because it is the answer to "who did I introduce, and was I paid for them?"
 */
export const DEAD_LINK_RETENTION_DAYS = 30;

/** The Stripe coupon created by `npm run stripe:setup`. */
export const REFERRAL_COUPON_ID = "cinevault-referral-first-month";

/**
 * Stamped on every balance transaction this file creates, so the billing page can say which
 * part of somebody's credit came from referring people.
 *
 * Stripe keeps one balance per customer with no notion of where the money came from, and the
 * transaction descriptions are free text nobody should be parsing. Metadata is the only
 * durable way to ask the question later.
 */
export const CREDIT_KIND = { kind: "referral" } as const;

/**
 * Code alphabet.
 *
 * No O/0, I/1/L. Even though these are only ever handed out inside a link, they are shown on
 * screen next to it, and a code that is ambiguous when read aloud generates a support ticket
 * rather than a signup.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

function newCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) code += ALPHABET[bytes[i] % ALPHABET.length];
  return code;
}

function startOfMonth(): Date {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * A link is dead when its status says so OR when its time has run out.
 *
 * Both halves matter. The sweep that writes `expired` runs on a schedule, and a link must
 * stop working the moment it expires rather than the next time a worker happens to look.
 */
function isLive(link: ReferralLink, now = new Date()): boolean {
  return link.status === "unused" && link.expiresAt > now;
}

/** SQL for the same rule, for the queries that have to count rather than inspect. */
function liveOrUsed() {
  return or(
    eq(referralLinks.status, "used"),
    and(eq(referralLinks.status, "unused"), gte(referralLinks.expiresAt, sql`now()`))
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Minting
// ═══════════════════════════════════════════════════════════════════════════════

export class LinkCapError extends Error {
  readonly code = "LINK_CAP";
  constructor(message: string) {
    super(message);
    this.name = "LinkCapError";
  }
}

/** How many of this month's slots are still available to a member. */
export async function slotsLeft(userId: string): Promise<number> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(referralLinks)
    .where(
      and(
        eq(referralLinks.ownerId, userId),
        gte(referralLinks.createdAt, startOfMonth()),
        liveOrUsed()
      )
    );

  return Math.max(0, MONTHLY_LINK_CAP - n);
}

/**
 * Mint an invite, spending one of this month's slots.
 *
 * The cap is re-checked here rather than trusted from the page that rendered the button,
 * because the button is a picture of the truth a moment ago and two tabs are one click apart.
 */
export async function generateLink(userId: string): Promise<ReferralLink> {
  if ((await slotsLeft(userId)) <= 0) {
    throw new LinkCapError(
      `You've used all ${MONTHLY_LINK_CAP} invites this month. Revoke an unused one, or wait for next month.`
    );
  }

  const expiresAt = new Date(Date.now() + LINK_LIFETIME_DAYS * 24 * 60 * 60 * 1000);

  // Retry on collision rather than trusting randomness: 31^8 is a big space, but "big enough
  // that it will not happen" is how you get a duplicate in production.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const [link] = await db
        .insert(referralLinks)
        .values({ ownerId: userId, code: newCode(), expiresAt })
        .returning();

      return link;
    } catch {
      // Unique violation on the code. Try another.
    }
  }

  throw new Error("could not generate a referral link");
}

/**
 * Kill an unused link and hand the slot back.
 *
 * Scoped to the owner in the WHERE clause, not checked first and updated after — the check
 * and the write have to be the same statement or a well-timed request revokes somebody
 * else's invite.
 */
export async function revokeLink(userId: string, linkId: string): Promise<boolean> {
  const revoked = await db
    .update(referralLinks)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(
      and(
        eq(referralLinks.id, linkId),
        eq(referralLinks.ownerId, userId),
        eq(referralLinks.status, "unused")
      )
    )
    .returning({ id: referralLinks.id });

  return revoked.length > 0;
}

/**
 * Mark links that have run out of time.
 *
 * Cosmetic only — `isLive` already refuses an out-of-date link and the slot count already
 * ignores one. This exists so the list reads "Expired" instead of "Unused" next to a date in
 * the past.
 */
export async function sweepExpiredLinks(): Promise<number> {
  const expired = await db
    .update(referralLinks)
    .set({ status: "expired" })
    .where(and(eq(referralLinks.status, "unused"), lt(referralLinks.expiresAt, new Date())))
    .returning({ id: referralLinks.id });

  return expired.length;
}

/**
 * Delete invites that died without being used.
 *
 * THREE separate guards, because this is the only code in the referral system that destroys
 * anything and the thing it must never destroy is somebody's record of a real referral:
 *
 *   1. Status must be `expired` or `revoked`. A `used` link is never a candidate, and neither
 *      is a live one.
 *   2. It must have been dead for DEAD_LINK_RETENTION_DAYS, so a member who revoked something
 *      yesterday can still see that they did.
 *   3. No ledger row may point at it — belt and braces over guard 1. If a referral exists for
 *      this link then somebody redeemed it, whatever the status column happens to say, and it
 *      is not going anywhere.
 *
 * Nothing in `referrals` is ever deleted by anything, at any age.
 */
export async function purgeDeadLinks(): Promise<number> {
  const cutoff = new Date(Date.now() - DEAD_LINK_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const gone = await db
    .delete(referralLinks)
    .where(
      and(
        or(eq(referralLinks.status, "expired"), eq(referralLinks.status, "revoked")),
        // Whichever ended it. COALESCE because a revoked link may still have a future
        // expiry, and an expired one was never revoked.
        lt(sql`coalesce(${referralLinks.revokedAt}, ${referralLinks.expiresAt})`, cutoff),
        // The column is spelled out rather than referenced through Drizzle: an unqualified
        // `id` inside a subquery binds to the INNER table, which would compare a link id to
        // itself and quietly match nothing.
        sql`not exists (select 1 from ${referrals} where ${referrals.linkId} = ${sql.raw('"referral_links"."id"')})`
      )
    )
    .returning({ id: referralLinks.id });

  return gone.length;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Admin invites — same table, kind = 'admin_invite', no cap, no discount, no credit
// ═══════════════════════════════════════════════════════════════════════════════

export type AdminInviteView = {
  id: string;
  code: string;
  state: "unused" | "used" | "revoked" | "expired";
  createdAt: Date;
  expiresAt: Date;
  usedByEmail: string | null;
  usedAt: Date | null;
};

/**
 * Mint an admin invite. No monthly cap (admins aren't slot-constrained), no discount
 * side-effect (see attachReferral where kind === "admin_invite" short-circuits before the
 * referrals row is written). Same collision-retry as the member generateLink.
 */
export async function generateAdminInvite(adminId: string): Promise<ReferralLink> {
  const expiresAt = new Date(Date.now() + LINK_LIFETIME_DAYS * 24 * 60 * 60 * 1000);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const [link] = await db
        .insert(referralLinks)
        .values({ ownerId: adminId, code: newCode(), expiresAt, kind: "admin_invite" })
        .returning();
      return link;
    } catch {
      // Unique violation on the code — try another.
    }
  }
  throw new Error("could not generate an admin invite");
}

/**
 * Revoke an unused admin invite. Scoped to the admin who created it AND kind='admin_invite'
 * so a leaked id can't be used to revoke someone's real referral link by mistake.
 */
export async function revokeAdminInvite(adminId: string, linkId: string): Promise<boolean> {
  const rows = await db
    .update(referralLinks)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(
      and(
        eq(referralLinks.id, linkId),
        eq(referralLinks.ownerId, adminId),
        eq(referralLinks.kind, "admin_invite"),
        eq(referralLinks.status, "unused")
      )
    )
    .returning({ id: referralLinks.id });
  return rows.length > 0;
}

/**
 * Every admin invite this admin has ever created. Resolves the "unused-but-past-expiry"
 * case to "expired" here so the UI never has to reason about clock vs. row status.
 */
export async function listAdminInvites(adminId: string): Promise<AdminInviteView[]> {
  const rows = await db
    .select()
    .from(referralLinks)
    .where(and(eq(referralLinks.ownerId, adminId), eq(referralLinks.kind, "admin_invite")))
    .orderBy(desc(referralLinks.createdAt))
    .limit(100);

  const now = new Date();
  return rows.map((link) => ({
    id: link.id,
    code: link.code,
    state:
      link.status === "unused" && link.expiresAt <= now
        ? "expired"
        : (link.status as AdminInviteView["state"]),
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    usedByEmail: link.usedByEmail,
    usedAt: link.usedAt,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Redemption
// ═══════════════════════════════════════════════════════════════════════════════

/** The live link for this code, or null. Case-insensitive, because people retype them. */
export async function findLink(code: string): Promise<ReferralLink | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;

  const [link] = await db
    .select()
    .from(referralLinks)
    .where(sql`upper(${referralLinks.code}) = upper(${trimmed})`)
    .limit(1);

  if (!link || !isLive(link)) return null;
  return link;
}

/**
 * Why a code will not work, for the page that has to explain it.
 *
 * `findLink` deliberately collapses every dead reason to null, which is right for redemption
 * and useless for telling somebody what happened. Revoked reports as `expired` on purpose:
 * "the person who sent this deleted it" is not a distinction the recipient can act on, and
 * saying so invites an awkward conversation with the friend who invited them.
 */
export type CodeState = "live" | "used" | "expired" | "unknown";

export async function inspectCode(code: string): Promise<CodeState> {
  const trimmed = code.trim();
  if (!trimmed) return "unknown";

  const [link] = await db
    .select()
    .from(referralLinks)
    .where(sql`upper(${referralLinks.code}) = upper(${trimmed})`)
    .limit(1);

  if (!link) return "unknown";
  if (link.status === "used") return "used";
  if (isLive(link)) return "live";
  return "expired";
}

/**
 * Who is inviting, for the "X invited you" line on the signup page. Returns null for
 * admin-issued invites — those are anonymous by design (no referrer to name and no
 * discount to promise), so the signup page renders as a plain "create your account" form
 * with the invite-only gate satisfied silently.
 */
export async function findInviter(code: string): Promise<User | null> {
  const link = await findLink(code);
  if (!link || link.kind === "admin_invite") return null;

  const [owner] = await db.select().from(users).where(eq(users.id, link.ownerId)).limit(1);
  return owner ?? null;
}

/**
 * Redeem an invite for a brand-new account.
 *
 * Called at signup, and it never throws — a dead or unrecognised link must not stop somebody
 * creating an account. The worst outcome is that nobody gets paid.
 */
export async function attachReferral(
  newUser: Pick<User, "id" | "email">,
  code: string | null
): Promise<void> {
  if (!code) return;

  try {
    const link = await findLink(code);

    // Redeeming your own invite is the one case worth blocking outright: it is not a
    // referral, it is a discount you wrote yourself.
    if (!link || link.ownerId === newUser.id) return;

    // Claim it with a CONDITIONAL update, and believe the result rather than the read above.
    // Two people opening the same link at the same moment both pass `findLink`; only one can
    // win this statement, and the loser simply signs up without a discount.
    const claimed = await db
      .update(referralLinks)
      .set({
        status: "used",
        usedById: newUser.id,
        usedByEmail: newUser.email,
        usedAt: new Date(),
      })
      .where(and(eq(referralLinks.id, link.id), eq(referralLinks.status, "unused")))
      .returning({ id: referralLinks.id });

    if (claimed.length === 0) return;

    // Admin invites stop here: link is claimed (so it can't be reused), but no referrals
    // row is written — the whole point is to satisfy the invite-only gate without triggering
    // the discount for the referee or the credit payout for the "referrer". A referredBy
    // link would be a lie (no member actually referred them) and the checkout would then
    // apply half off, which is exactly what admin invites exist to avoid.
    if (link.kind === "admin_invite") return;

    const [owner] = await db.select().from(users).where(eq(users.id, link.ownerId)).limit(1);
    if (!owner) return;

    await db
      .update(users)
      .set({ referredBy: owner.id, updatedAt: new Date() })
      .where(eq(users.id, newUser.id));

    await db.insert(referrals).values({
      referrerId: owner.id,
      referrerEmail: owner.email,
      refereeId: newUser.id,
      refereeEmail: newUser.email,
      linkId: link.id,
      code: link.code,
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

// ═══════════════════════════════════════════════════════════════════════════════
// Paying out
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Pay the referrer, if this user was referred and has just paid for the first time.
 *
 * Called from the Stripe webhook on a successful payment. Safe to call repeatedly: the
 * referral only moves out of `pending` once, so a redelivered webhook cannot pay twice.
 *
 * No cap check here. The slot was spent when the link was generated; refusing to pay now
 * would mean charging somebody a slot and then keeping the reward.
 */
export async function rewardForFirstPayment(
  refereeId: string,
  /** The invoice that just paid, so a later refund can be matched back to this reward. */
  invoiceId?: string
): Promise<void> {
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

  if (!referrer.stripeCustomerId) {
    // Nothing to credit against yet. Left pending so it pays out if they ever subscribe.
    return;
  }

  try {
    // Resolved before the credit, not after, so a reward is never written without the handle
    // a refund would need to find it. Failing to resolve it is not fatal — see the helper.
    const paymentIntentId = invoiceId ? await paymentIntentFor(invoiceId) : null;

    // A NEGATIVE balance transaction is a credit in Stripe: the customer balance is what they
    // owe, so reducing it is money off. Positive would bill them for referring somebody.
    await stripe.customers.createBalanceTransaction(referrer.stripeCustomerId, {
      amount: -REFERRAL_REWARD,
      currency: REFERRAL_CURRENCY,
      description: `Referral credit — ${referral.refereeEmail}`,
      metadata: CREDIT_KIND,
    });

    await db
      .update(referrals)
      .set({
        status: "rewarded",
        rewardAmount: REFERRAL_REWARD,
        rewardCurrency: REFERRAL_CURRENCY,
        rewardedAt: new Date(),
        triggerPaymentIntentId: paymentIntentId,
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

/**
 * The PaymentIntent behind an invoice.
 *
 * Needs an extra call because the webhook's invoice arrives with `payments` unexpanded. Only
 * ever runs when a reward is actually about to be paid, which is rare, so the call costs
 * nothing in practice.
 *
 * Returns null rather than throwing. Without it a clawback simply cannot match this reward
 * later, and losing the ability to reverse $5 is a far better outcome than failing the
 * webhook and losing the reward — or worse, retrying it.
 */
async function paymentIntentFor(invoiceId: string): Promise<string | null> {
  try {
    const invoice = await stripe.invoices.retrieve(invoiceId, { expand: ["payments"] });
    const payment = invoice.payments?.data?.[0]?.payment;
    const intent = payment?.payment_intent;

    return typeof intent === "string" ? intent : (intent?.id ?? null);
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Taking it back
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Reverse a referral credit when the payment that earned it goes away.
 *
 * The rule: a reward stands as long as the money that bought it stands. If the referee
 * charges back or takes a full refund on the payment we paid out on, the $5 comes back off
 * the referrer's balance.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *   - A partial refund leaves the credit alone. Refunding $3 of goodwill should not cost
 *     somebody else $5, and the referee did pay.
 *   - A refund on a LATER invoice leaves it alone too, which is what the payment intent is
 *     matched on. Somebody who stayed six months was a real referral no matter how month six
 *     ended.
 *
 * Idempotent: only a `rewarded` row can be reversed, so a redelivered refund event is a
 * no-op rather than a second $5 charged back to the referrer.
 */
export async function reverseReward(
  paymentIntentId: string,
  reason: "refund" | "dispute"
): Promise<boolean> {
  const [referral] = await db
    .select()
    .from(referrals)
    .where(
      and(
        eq(referrals.triggerPaymentIntentId, paymentIntentId),
        eq(referrals.status, "rewarded")
      )
    )
    .limit(1);

  if (!referral?.referrerId) return false;

  const [referrer] = await db
    .select()
    .from(users)
    .where(eq(users.id, referral.referrerId))
    .limit(1);

  if (!referrer?.stripeCustomerId) return false;

  const amount = referral.rewardAmount ?? REFERRAL_REWARD;

  try {
    // POSITIVE this time. The balance is what they owe, so adding to it removes the credit.
    // Sign errors here are silent and expensive, which is why both directions say so.
    await stripe.customers.createBalanceTransaction(referrer.stripeCustomerId, {
      amount,
      currency: referral.rewardCurrency ?? REFERRAL_CURRENCY,
      description: `Referral credit reversed (${reason}) — ${referral.refereeEmail}`,
      metadata: CREDIT_KIND,
    });

    await db
      .update(referrals)
      .set({ status: "reversed", reversedAt: new Date(), reversedReason: reason })
      .where(eq(referrals.id, referral.id));

    await logEvent({
      type: "admin_action",
      severity: "warn",
      actor: "webhook",
      userId: referrer.id,
      email: referrer.email,
      message: `referral credit reversed for ${referrer.email} (${reason} by ${referral.refereeEmail})`,
      detail: { referralId: referral.id, amount, reason, paymentIntentId },
    });

    return true;
  } catch (err) {
    // Left `rewarded` on purpose. A Stripe blip means the next delivery of this event tries
    // again, rather than the row saying "reversed" over a credit that is still sitting there.
    await logError(
      "could not reverse referral credit",
      { error: err instanceof Error ? err.message : String(err), referralId: referral.id },
      { userId: referrer.id, email: referrer.email, actor: "webhook" }
    );

    return false;
  }
}

/**
 * Put a credit back after a dispute is won.
 *
 * Stripe pulls the money at `dispute.created` and returns it if you win, so the referrer's
 * credit should follow the same path. Without this, one chargeback that the customer loses
 * still costs the referrer their $10 permanently.
 */
export async function restoreReward(paymentIntentId: string): Promise<boolean> {
  const [referral] = await db
    .select()
    .from(referrals)
    .where(
      and(
        eq(referrals.triggerPaymentIntentId, paymentIntentId),
        eq(referrals.status, "reversed"),
        eq(referrals.reversedReason, "dispute")
      )
    )
    .limit(1);

  if (!referral?.referrerId) return false;

  const [referrer] = await db
    .select()
    .from(users)
    .where(eq(users.id, referral.referrerId))
    .limit(1);

  if (!referrer?.stripeCustomerId) return false;

  const amount = referral.rewardAmount ?? REFERRAL_REWARD;

  try {
    await stripe.customers.createBalanceTransaction(referrer.stripeCustomerId, {
      amount: -amount,
      currency: referral.rewardCurrency ?? REFERRAL_CURRENCY,
      description: `Referral credit restored — ${referral.refereeEmail}`,
      metadata: CREDIT_KIND,
    });

    await db
      .update(referrals)
      .set({ status: "rewarded", reversedAt: null, reversedReason: null })
      .where(eq(referrals.id, referral.id));

    await logEvent({
      type: "admin_action",
      actor: "webhook",
      userId: referrer.id,
      email: referrer.email,
      message: `referral credit restored for ${referrer.email} (dispute won)`,
      detail: { referralId: referral.id, amount, paymentIntentId },
    });

    return true;
  } catch (err) {
    await logError(
      "could not restore referral credit",
      { error: err instanceof Error ? err.message : String(err), referralId: referral.id },
      { userId: referrer.id, email: referrer.email, actor: "webhook" }
    );

    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Reading
// ═══════════════════════════════════════════════════════════════════════════════

/** What the page shows for one invite. */
export type InviteView = {
  id: string;
  code: string;
  /** unused | used | revoked | expired — already resolved against the clock. */
  state: "unused" | "used" | "revoked" | "expired";
  createdAt: Date;
  expiresAt: Date;
  usedByEmail: string | null;
  usedAt: Date | null;
  /** Set once the person who used it has paid and the credit has landed. */
  rewardAmount: number | null;
  rewardCurrency: string | null;
  rewardedAt: Date | null;
  /** True when that payment was refunded or disputed and the credit was taken back. */
  reversed: boolean;
};

export type ReferralSummary = {
  invites: InviteView[];
  slotsLeft: number;
  cap: number;
  /** Live invites nobody has used yet. */
  outstanding: number;
  /** Used, but the person hasn't paid yet. */
  pending: number;
  rewarded: number;
  /** Total credited, in minor units. */
  earned: number;
  currency: string;
};

export async function getSummary(user: Pick<User, "id">): Promise<ReferralSummary> {
  // One join rather than a query per invite: the ledger row is what turns "used" into
  // "credited", and the page wants both on the same line.
  const rows = await db
    .select({ link: referralLinks, referral: referrals })
    .from(referralLinks)
    .leftJoin(referrals, eq(referrals.linkId, referralLinks.id))
    .where(eq(referralLinks.ownerId, user.id))
    .orderBy(desc(referralLinks.createdAt))
    .limit(50);

  const now = new Date();

  const invites: InviteView[] = rows.map(({ link, referral }) => ({
    id: link.id,
    code: link.code,
    // Resolved here so nothing downstream has to know that an "unused" row with a past date
    // is really expired.
    state:
      link.status === "unused" && link.expiresAt <= now
        ? "expired"
        : (link.status as InviteView["state"]),
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    usedByEmail: link.usedByEmail,
    usedAt: link.usedAt,
    rewardAmount: referral?.rewardAmount ?? null,
    rewardCurrency: referral?.rewardCurrency ?? null,
    rewardedAt: referral?.status === "reversed" ? null : (referral?.rewardedAt ?? null),
    reversed: referral?.status === "reversed",
  }));

  // Earnings come from the ledger, not from the invites above, so credit from a link that
  // has since been deleted still shows up in the total.
  const ledger = await db
    .select()
    .from(referrals)
    .where(eq(referrals.referrerId, user.id));

  return {
    invites,
    slotsLeft: await slotsLeft(user.id),
    cap: MONTHLY_LINK_CAP,
    outstanding: invites.filter((i) => i.state === "unused").length,
    pending: ledger.filter((r) => r.status === "pending").length,
    rewarded: ledger.filter((r) => r.status === "rewarded").length,
    // Reversed credits are excluded from BOTH. The money went back to Stripe, so a total that
    // still counted it would be a number the member could not reconcile against their invoice.
    earned: ledger
      .filter((r) => r.status === "rewarded")
      .reduce((total, r) => total + (r.rewardAmount ?? 0), 0),
    currency: REFERRAL_CURRENCY,
  };
}

export type { Referral };

/** Has this member ever created an invite? Drives the "there is something here" dot. */
export async function hasAnyInvite(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: referralLinks.id })
    .from(referralLinks)
    .where(eq(referralLinks.ownerId, userId))
    .limit(1);

  return Boolean(row);
}
