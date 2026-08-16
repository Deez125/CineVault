import "server-only";

import { desc, eq, sum } from "drizzle-orm";
import { db } from "@/lib/db";
import { adminCosts, type AdminCost, type NewAdminCost } from "@/lib/db/schema";

/**
 * Fixed monthly costs the admin types in.
 *
 * Kept separate from anything derived from Stripe: MRR is what customers pay, costs are what
 * WE pay, and the profit line on the analytics page is `mrr - sum(active costs)`. The unit
 * everywhere is cents-per-month, matching MRR, so profit is a straight subtraction with no
 * conversion. Yearly costs get divided by the admin before typing — see the notes column
 * for a "×12" reminder next to those rows.
 */

export async function listCosts(): Promise<AdminCost[]> {
  return db.select().from(adminCosts).orderBy(desc(adminCosts.active), adminCosts.name);
}

export async function totalActiveMonthlyCents(): Promise<number> {
  const [row] = await db
    .select({ total: sum(adminCosts.monthlyCents).mapWith(Number) })
    .from(adminCosts)
    .where(eq(adminCosts.active, true));

  // sum() returns null when there are no rows — coerce here so callers can trust a number.
  return row?.total ?? 0;
}

export async function createCost(input: {
  name: string;
  monthlyCents: number;
  notes?: string | null;
}): Promise<AdminCost> {
  const [row] = await db
    .insert(adminCosts)
    .values({
      name: input.name.trim(),
      monthlyCents: Math.round(input.monthlyCents),
      notes: input.notes?.trim() || null,
    })
    .returning();
  return row;
}

export async function updateCost(
  id: string,
  patch: Partial<Pick<NewAdminCost, "name" | "monthlyCents" | "notes" | "active">>
): Promise<AdminCost | null> {
  const values: Partial<NewAdminCost> = { updatedAt: new Date() };
  if (patch.name !== undefined) values.name = patch.name.trim();
  if (patch.monthlyCents !== undefined) values.monthlyCents = Math.round(patch.monthlyCents);
  if (patch.notes !== undefined) values.notes = patch.notes?.trim() || null;
  if (patch.active !== undefined) values.active = patch.active;

  const [row] = await db
    .update(adminCosts)
    .set(values)
    .where(eq(adminCosts.id, id))
    .returning();
  return row ?? null;
}

export async function deleteCost(id: string): Promise<boolean> {
  // Hard delete. `active=false` is the "keep the row, hide from totals" path; delete is
  // reserved for "this was a typo, remove it entirely".
  const rows = await db.delete(adminCosts).where(eq(adminCosts.id, id)).returning();
  return rows.length > 0;
}

/** Sanity guard for the server action layer — validation lives with the action itself. */
export function isValidCostAmount(cents: number): boolean {
  return Number.isFinite(cents) && cents >= 0 && cents < 100_000_00; // $100k/mo ceiling
}
