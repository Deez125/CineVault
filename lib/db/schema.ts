import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * `WHERE <column> IS NOT NULL`, for partial unique indexes.
 *
 * Postgres treats every NULL as distinct, so a plain unique index on a nullable column
 * already allows many NULLs. The partial index is here to make that explicit and to keep the
 * index small — most rows have no Plex account linked.
 */
const notNull = (column: string) => sql.raw(`"${column}" IS NOT NULL`);

/**
 * The database schema.
 *
 * One idea runs through all of it: **Stripe is the source of truth.** A user's entitlement
 * lives in exactly one place, their Stripe subscription. Everything stored here about their
 * subscription is a CACHE of that, kept warm by webhooks and repaired every few minutes by
 * the reconciler. If this database and Stripe ever disagree, Stripe is right and this is
 * stale — never the other way around.
 *
 * The consequence you have to internalise: to give someone access you do not set a flag here,
 * you create or activate their Stripe subscription and let the entitlement engine write the
 * flag. To take it away, you cancel the subscription.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// users
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * One row per customer.
 *
 * The primary key is a UUID we mint, NOT the email and NOT any external id. The previous
 * build keyed on the Discord user id, which meant the entire system was welded to Discord and
 * removing Discord meant rebuilding from the schema up. External identities (Plex today,
 * Discord if it ever comes back) hang off this row as nullable columns and can be detached
 * without the account ceasing to exist.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Always stored lowercased. Compare lowercased. See lib/auth/. */
    email: text("email").notNull(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),

    /** scrypt, from node:crypto. Format and verification live in lib/auth/password.ts. */
    passwordHash: text("password_hash").notNull(),

    /**
     * Who they are, as they'd like to be called.
     *
     * All optional. Signup asks for an email and a password and nothing else, because every
     * extra required field at signup is a reason to close the tab — these get filled in from
     * settings, or never. `displayName()` in lib/display-name.ts works out what to show.
     */
    firstName: text("first_name"),
    lastName: text("last_name"),

    /**
     * A short handle, unique case-insensitively (see the index below). Stored exactly as
     * typed so "JoMat" stays "JoMat", but nobody else can take "jomat".
     */
    username: text("username"),

    /** Reserved for a profile picture. Nothing writes it yet. */
    avatarUrl: text("avatar_url"),

    /**
     * Who sent them, captured at SIGNUP.
     *
     * Recorded then rather than at checkout because that is when the link was followed. If it
     * waited for checkout, anybody who signed up today and paid next week would lose their
     * referrer, and the person who introduced them would never be paid.
     */
    referredBy: uuid("referred_by"),

    /**
     * Granted from the ADMIN_EMAILS allowlist. Checked on every admin request, never trusted
     * from the client. An empty allowlist means nobody is an admin.
     */
    isAdmin: boolean("is_admin").notNull().default(false),

    /**
     * A banned user gets nothing even if their Stripe subscription is active and paid. This
     * is checked inside applyEntitlement, so it cannot be bypassed by any code path that
     * grants access.
     */
    banned: boolean("banned").notNull().default(false),
    bannedAt: timestamp("banned_at", { withTimezone: true }),
    bannedReason: text("banned_reason"),

    // ── Plex identity ────────────────────────────────────────────────────────
    // One Plex account per user, enforced by a unique index below. Plex has no invite links,
    // so these are learned through the device-PIN flow: the user's own Plex token is read
    // once to discover who they are and then discarded. We never store it.
    plexUserId: text("plex_user_id"),
    plexUsername: text("plex_username"),
    plexEmail: text("plex_email"),
    plexLinkedAt: timestamp("plex_linked_at", { withTimezone: true }),

    // ── Stripe mirror ────────────────────────────────────────────────────────
    // Cache of the subscription. Never the authority. Money is stored in MINOR UNITS
    // (2000 = $20.00) with its currency, and formatted only at display.
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    subStatus: text("sub_status"),
    subPriceId: text("sub_price_id"),
    subAmount: integer("sub_amount"),
    subCurrency: text("sub_currency"),
    subInterval: text("sub_interval"),
    subCancelAtPeriodEnd: boolean("sub_cancel_at_period_end").notNull().default(false),
    subCurrentPeriodEnd: timestamp("sub_current_period_end", { withTimezone: true }),

    // ── Derived entitlement ──────────────────────────────────────────────────
    // Written ONLY by applyEntitlement(). If you find yourself setting these anywhere else,
    // that is the bug.
    isMember: boolean("is_member").notNull().default(false),
    streamLimit: integer("stream_limit").notNull().default(0),

    /** none | invited | removed — the state of the Plex library share. */
    shareState: text("share_state").notNull().default("none"),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    removedAt: timestamp("removed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_email_key").on(t.email),
    // One Plex account may be attached to at most one CineVault account. Without this, one
    // person could link the same Plex account to several cheap subscriptions and stack
    // stream slots for free. Partial so that the many NULLs don't collide.
    uniqueIndex("users_plex_user_id_key")
      .on(t.plexUserId)
      .where(notNull("plex_user_id")),
    uniqueIndex("users_stripe_customer_id_key")
      .on(t.stripeCustomerId)
      .where(notNull("stripe_customer_id")),
    // Case-insensitive: "JoMat" and "jomat" are the same handle to everyone reading it, so
    // letting both exist would make impersonation a matter of changing one capital letter.
    uniqueIndex("users_username_key")
      .on(sql`lower(${t.username})`)
      .where(notNull("username")),
    index("users_stripe_subscription_id_idx").on(t.stripeSubscriptionId),
    index("users_is_member_idx").on(t.isMember),
  ]
);

// ═══════════════════════════════════════════════════════════════════════════════
// sessions
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sessions are ROWS, not signed cookies.
 *
 * A stateless signed cookie cannot be revoked: changing a password, banning an account, or
 * an admin kicking a stolen session all become "wait for it to expire". Since this app can
 * revoke someone's paid access, we need to be able to revoke their session too.
 *
 * The primary key is the SHA-256 of the token, never the token. The raw token exists only in
 * the user's cookie. If this table leaks, nobody's session is usable.
 */
export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 hex of the session token. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    /** For a "signed in devices" list, and for spotting a session used from somewhere odd. */
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)]
);

// ═══════════════════════════════════════════════════════════════════════════════
// email tokens
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Single-use tokens for email verification and password reset.
 *
 * Same rule as sessions: the id is the HASH of the token, and the raw token only ever exists
 * in the email we send. A leak of this table does not let anyone reset a password.
 */
export const emailTokens = pgTable(
  "email_tokens",
  {
    /** SHA-256 hex of the token. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /** verify_email | reset_password */
    purpose: text("purpose").notNull(),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Set the moment it is redeemed, so a token cannot be used twice. */
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("email_tokens_user_id_idx").on(t.userId)]
);

// ═══════════════════════════════════════════════════════════════════════════════
// events — the audit log
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Every consequential action, in order. This is what the admin activity feed reads, and it is
 * the only record of why someone lost access at 3am.
 *
 * The email and Plex username are DENORMALISED onto each row on purpose. An audit log that
 * says "user 4f2a-… was revoked" and then loses the account is not an audit log. These
 * columns keep the history readable after the user row is gone.
 */
export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),

    /** membership_gained | membership_lost | access_granted | plex_linked | … */
    type: text("type").notNull(),
    /** info | warn | error */
    severity: text("severity").notNull().default("info"),

    /** Nullable and SET NULL on delete: the log outlives the account. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),

    /** Who did it: system | webhook | reconciler | enforcer | user | admin:<uuid> */
    actor: text("actor").notNull().default("system"),

    email: text("email"),
    plexUsername: text("plex_username"),

    message: text("message").notNull(),
    /** Structured extras. Money here is minor units + currency, formatted at display. */
    detail: jsonb("detail"),
  },
  (t) => [
    index("events_ts_idx").on(t.ts),
    index("events_type_idx").on(t.type),
    index("events_user_id_idx").on(t.userId),
  ]
);

// ═══════════════════════════════════════════════════════════════════════════════
// announcements
// ═══════════════════════════════════════════════════════════════════════════════

/** Admin-posted banner on the signed-in dashboard. Built out with the admin panel. */
export const announcements = pgTable(
  "announcements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    body: text("body"),
    /** info | warning | destructive | success — drives the banner colour. */
    severity: text("severity").notNull().default("info"),

    active: boolean("active").notNull().default(true),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),

    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("announcements_active_idx").on(t.active)]
);

/** Remembers that a user closed a banner, so it stays closed. */
export const announcementDismissals = pgTable(
  "announcement_dismissals",
  {
    announcementId: uuid("announcement_id")
      .notNull()
      .references(() => announcements.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("announcement_dismissals_key").on(t.announcementId, t.userId)]
);

// ═══════════════════════════════════════════════════════════════════════════════
// support tickets
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A support conversation.
 *
 * This is what replaces the Discord #support channel, so it has to be at least as good at the
 * one thing that channel was good at: somebody says something and the other person sees it
 * without being told to go and look.
 */
export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /**
     * SET NULL rather than cascade. A deleted account must not take its support history with
     * it — the conversation is the record of what was promised, and `email` below keeps it
     * readable afterwards.
     */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    email: text("email").notNull(),

    subject: text("subject").notNull(),
    /** open | closed */
    status: text("status").notNull().default("open"),

    /**
     * low | normal | high | urgent — set by the member when they open it.
     *
     * Their word on how urgent it is, not ours. An admin can see at a glance which of five
     * open tickets to read first, and somebody marking everything urgent tells you something
     * too.
     */
    priority: text("priority").notNull().default("normal"),

    /** general | billing | plex | account — what it is about, for sorting the inbox. */
    category: text("category").notNull().default("general"),

    /**
     * Denormalised from the last message. The inbox sorts by it, and computing it with a
     * correlated subquery on every list would be a join per row for something written once
     * per message.
     */
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),

    /**
     * What each side has seen. Two timestamps rather than an unread flag, because "unread"
     * has to mean something different to each party and a single boolean cannot.
     */
    userReadAt: timestamp("user_read_at", { withTimezone: true }),
    adminReadAt: timestamp("admin_read_at", { withTimezone: true }),

    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: uuid("closed_by").references(() => users.id, { onDelete: "set null" }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tickets_user_id_idx").on(t.userId),
    index("tickets_status_idx").on(t.status),
    index("tickets_last_message_at_idx").on(t.lastMessageAt),
  ]
);

/**
 * One message in a conversation.
 *
 * The id is a bigserial rather than a uuid ON PURPOSE: the live view polls with
 * `?since=<id>`, and that only works with an ordering the client can compare. A random uuid
 * gives no such ordering, so the cursor would have to be a timestamp — and two messages in
 * the same millisecond would then either duplicate or vanish.
 */
export const ticketMessages = pgTable(
  "ticket_messages",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),

    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    /** user | admin | system */
    authorRole: text("author_role").notNull(),
    /** Captured at the time of writing, so a later rename does not rewrite history. */
    authorName: text("author_name").notNull(),

    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ticket_messages_ticket_id_idx").on(t.ticketId, t.id)]
);

// ═══════════════════════════════════════════════════════════════════════════════
// referral_links
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * One invite, minted on demand.
 *
 * Deliberately not a permanent per-user code. A member presses "generate", spends one of
 * their monthly slots, and gets back a link with its own life: it is used once, revoked, or
 * it expires. That means the referrals page can show what happened to each individual invite
 * rather than a single number that went up, and it puts a natural ceiling on how far one
 * person's code can travel.
 *
 * The monthly cap is therefore spent HERE, at generation, not at payout. A slot buys the
 * right to invite somebody; whether they ever pay is a separate question answered by the
 * ledger below.
 */
export const referralLinks = pgTable(
  "referral_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Who minted it. CASCADE: an invite has no meaning without its owner. */
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    code: text("code").notNull(),

    /**
     * unused  — live, waiting for somebody
     * used    — somebody signed up with it; terminal
     * revoked — the owner killed it early and got the slot back
     * expired — ran out of time and released the slot
     *
     * `expired` is written by the worker's sweep, but nothing depends on that having run:
     * every read also checks expiresAt, so a link is dead on time whether or not a row has
     * caught up with it.
     */
    status: text("status").notNull().default("unused"),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    /** Who redeemed it. SET NULL so a used link stays used if that account is deleted. */
    usedById: uuid("used_by_id").references(() => users.id, { onDelete: "set null" }),
    usedByEmail: text("used_by_email"),
    usedAt: timestamp("used_at", { withTimezone: true }),

    revokedAt: timestamp("revoked_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Case-insensitive and global. Two live links with the same code would make redemption
    // ambiguous, and codes are compared without regard to case because people retype them.
    uniqueIndex("referral_links_code_key").on(sql`upper(${t.code})`),
    // The slot count is "links this owner created this month", so it is read by owner and
    // date on every page load.
    index("referral_links_owner_idx").on(t.ownerId, t.createdAt),
    index("referral_links_status_idx").on(t.status),
  ]
);

// ═══════════════════════════════════════════════════════════════════════════════
// referrals
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * One row per person who signed up through somebody's code.
 *
 * A ledger, not a flag. "Did this referral pay out?" and "how many has this person been paid
 * for this month?" are both questions about history, and a boolean on the user row could
 * answer neither — nor could it survive the referee deleting their account, which is exactly
 * when you most want to know what was already paid.
 */
export const referrals = pgTable(
  "referrals",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Who gets paid. SET NULL so the ledger outlives a closed account. */
    referrerId: uuid("referrer_id").references(() => users.id, { onDelete: "set null" }),
    referrerEmail: text("referrer_email").notNull(),

    /** Who signed up. */
    refereeId: uuid("referee_id").references(() => users.id, { onDelete: "set null" }),
    refereeEmail: text("referee_email").notNull(),

    /** The link this came from. SET NULL so the ledger survives a deleted invite. */
    linkId: uuid("link_id").references(() => referralLinks.id, { onDelete: "set null" }),

    /** The code as it was used, copied here so the ledger reads on its own. */
    code: text("code").notNull(),

    /**
     * pending  — signed up, has not paid yet
     * rewarded — referee paid, referrer credited
     * reversed — that payment was refunded or disputed, the credit has been taken back
     *
     * There is no `capped` any more: the monthly limit is spent when the link is generated,
     * so anything that made it as far as a signup has already been paid for.
     */
    status: text("status").notNull().default("pending"),

    /** Minor units actually credited. Null until it pays out. Kept after a reversal. */
    rewardAmount: integer("reward_amount"),
    rewardCurrency: text("reward_currency"),
    rewardedAt: timestamp("rewarded_at", { withTimezone: true }),

    /**
     * The payment that earned the reward.
     *
     * Recorded so a clawback can tell "they refunded the payment we paid out on" from "they
     * refunded month six". Only the former should cost the referrer their credit — somebody
     * who stayed half a year was a real referral whatever happened later.
     */
    triggerPaymentIntentId: text("trigger_payment_intent_id"),

    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    /** refund | dispute */
    reversedReason: text("reversed_reason"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One referral per referee, ever. Without this a webhook redelivery would pay the
    // referrer twice for the same person.
    uniqueIndex("referrals_referee_key").on(t.refereeId).where(notNull("referee_id")),
    index("referrals_referrer_idx").on(t.referrerId),
    index("referrals_status_idx").on(t.status),
    // A refund webhook arrives knowing only the payment. This is how it finds the reward.
    index("referrals_trigger_payment_idx").on(t.triggerPaymentIntentId),
  ]
);

// ═══════════════════════════════════════════════════════════════════════════════
// kv
// ═══════════════════════════════════════════════════════════════════════════════

/** Small JSON state that isn't customer data — the recently-added feed marker, and so on. */
export const kv = pgTable("kv", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════════════

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type EmailToken = typeof emailTokens.$inferSelect;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type Announcement = typeof announcements.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type TicketMessage = typeof ticketMessages.$inferSelect;
export type Referral = typeof referrals.$inferSelect;
export type ReferralLink = typeof referralLinks.$inferSelect;
