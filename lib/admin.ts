import { and, count, desc, eq, gte, ilike, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { events, users, type User } from "@/lib/db/schema";

/**
 * Reads for the admin panel.
 *
 * Queries only. Every action that CHANGES something goes through applyEntitlement or the
 * Stripe/Plex services, never through here — the moment the admin panel starts writing
 * `is_member` directly, there are two answers to who has access.
 */

export type UserFilter = "all" | "members" | "inactive" | "unlinked" | "banned";

export type UserListItem = Pick<
  User,
  | "id"
  | "email"
  | "firstName"
  | "lastName"
  | "username"
  | "isAdmin"
  | "banned"
  | "isMember"
  | "streamLimit"
  | "subStatus"
  | "subAmount"
  | "subCurrency"
  | "subCancelAtPeriodEnd"
  | "subCurrentPeriodEnd"
  | "plexUsername"
  | "shareState"
  | "stripeCustomerId"
  | "createdAt"
>;

export async function listUsers({
  search,
  filter = "all",
  limit = 100,
}: {
  search?: string;
  filter?: UserFilter;
  limit?: number;
} = {}): Promise<UserListItem[]> {
  const where: SQL[] = [];

  if (search?.trim()) {
    // ilike both sides: an admin looking somebody up has a fragment of an email or a Plex
    // name, not an exact string, and certainly not a UUID.
    const term = `%${search.trim()}%`;
    const match = or(
      ilike(users.email, term),
      ilike(users.plexUsername, term),
      ilike(users.firstName, term),
      ilike(users.lastName, term),
      ilike(users.username, term)
    );
    if (match) where.push(match);
  }

  switch (filter) {
    case "members":
      where.push(eq(users.isMember, true));
      break;
    case "inactive":
      where.push(eq(users.isMember, false));
      break;
    case "unlinked":
      // The number worth acting on: paying, but no Plex account attached, so they cannot
      // watch anything and probably do not know why.
      where.push(and(eq(users.isMember, true), isNull(users.plexUsername))!);
      break;
    case "banned":
      where.push(eq(users.banned, true));
      break;
  }

  return db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      username: users.username,
      isAdmin: users.isAdmin,
      banned: users.banned,
      isMember: users.isMember,
      streamLimit: users.streamLimit,
      subStatus: users.subStatus,
      subAmount: users.subAmount,
      subCurrency: users.subCurrency,
      subCancelAtPeriodEnd: users.subCancelAtPeriodEnd,
      subCurrentPeriodEnd: users.subCurrentPeriodEnd,
      plexUsername: users.plexUsername,
      shareState: users.shareState,
      stripeCustomerId: users.stripeCustomerId,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(users.isMember), desc(users.createdAt))
    .limit(Math.min(limit, 500));
}

export type AdminStats = {
  members: number;
  total: number;
  linked: number;
  /** Paying but with no Plex account attached. The number worth chasing. */
  awaitingLink: number;
  banned: number;
  /** Monthly recurring revenue in minor units, from what members are actually on. */
  mrr: number;
  currency: string;
  cancelling: number;
  errors24h: number;
  signups7d: number;
};

export async function getStats(): Promise<AdminStats> {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // One round trip. Six separate counts would be six queries for a page that reloads often.
  const [row] = await db
    .select({
      total: count(),
      members: sql<number>`count(*) filter (where ${users.isMember})`.mapWith(Number),
      linked: sql<number>`count(*) filter (where ${users.plexUsername} is not null)`.mapWith(Number),
      awaitingLink:
        sql<number>`count(*) filter (where ${users.isMember} and ${users.plexUsername} is null)`.mapWith(
          Number
        ),
      banned: sql<number>`count(*) filter (where ${users.banned})`.mapWith(Number),
      cancelling:
        sql<number>`count(*) filter (where ${users.isMember} and ${users.subCancelAtPeriodEnd})`.mapWith(
          Number
        ),
      // Only from people who are actually entitled. Summing every row would count cancelled
      // subscriptions as revenue.
      mrr: sql<number>`coalesce(sum(${users.subAmount}) filter (where ${users.isMember}), 0)`.mapWith(
        Number
      ),
      signups7d: sql<number>`count(*) filter (where ${users.createdAt} >= ${weekAgo})`.mapWith(Number),
    })
    .from(users);

  const [errorRow] = await db
    .select({ n: count() })
    .from(events)
    .where(and(eq(events.severity, "error"), gte(events.ts, dayAgo)));

  return {
    total: row?.total ?? 0,
    members: row?.members ?? 0,
    linked: row?.linked ?? 0,
    awaitingLink: row?.awaitingLink ?? 0,
    banned: row?.banned ?? 0,
    cancelling: row?.cancelling ?? 0,
    mrr: row?.mrr ?? 0,
    currency: "usd",
    errors24h: errorRow?.n ?? 0,
    signups7d: row?.signups7d ?? 0,
  };
}

/** One member, in full, for the detail drawer. */
export async function getUser(id: string): Promise<User | null> {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user ?? null;
}

/** Plex accounts attached to more than one CineVault account. Should always be empty. */
export async function findDuplicatePlexAccounts() {
  return db
    .select({
      plexUsername: users.plexUsername,
      n: count(),
    })
    .from(users)
    .where(isNotNull(users.plexUserId))
    .groupBy(users.plexUsername)
    .having(sql`count(*) > 1`);
}
