"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import {
  createCost,
  deleteCost,
  isValidCostAmount,
  updateCost,
} from "@/lib/analytics/costs";

/**
 * Server actions for the costs CRUD UI.
 *
 * Guarded by requireAdmin — not by the layout gate alone. Server actions can be invoked
 * directly by anyone who guesses the endpoint, and gating pages is not the same as gating
 * mutations. Same rule as everywhere else in this codebase.
 */

export type CostFormState = { error?: string; success?: string } | null;

/** Parse a "$12.50" / "12.5" / "1250" text input into monthly cents. */
function parseAmount(input: FormDataEntryValue | null): number | null {
  if (input === null) return null;
  const raw = String(input).replace(/[^0-9.-]/g, "").trim();
  if (!raw) return null;
  const dollars = Number(raw);
  if (!Number.isFinite(dollars) || dollars < 0) return null;
  // Round to nearest cent — inputs like "12.005" collapse cleanly.
  return Math.round(dollars * 100);
}

export async function createCostAction(
  _prev: CostFormState,
  formData: FormData
): Promise<CostFormState> {
  await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name is required." };

  const cents = parseAmount(formData.get("monthly"));
  if (cents === null) return { error: "Enter a monthly amount, e.g. 12.99" };
  if (!isValidCostAmount(cents)) return { error: "That amount looks wrong." };

  const notes = String(formData.get("notes") ?? "").trim() || null;

  await createCost({ name, monthlyCents: cents, notes });
  revalidatePath("/admin/analytics");
  return { success: `Added "${name}".` };
}

export async function updateCostAction(
  _prev: CostFormState,
  formData: FormData
): Promise<CostFormState> {
  await requireAdmin();

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Missing id." };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name is required." };

  const cents = parseAmount(formData.get("monthly"));
  if (cents === null) return { error: "Enter a monthly amount." };
  if (!isValidCostAmount(cents)) return { error: "That amount looks wrong." };

  const notes = String(formData.get("notes") ?? "").trim() || null;

  const row = await updateCost(id, { name, monthlyCents: cents, notes });
  if (!row) return { error: "That cost is gone." };

  revalidatePath("/admin/analytics");
  return { success: "Saved." };
}

export async function toggleCostAction(
  _prev: CostFormState,
  formData: FormData
): Promise<CostFormState> {
  await requireAdmin();

  const id = String(formData.get("id") ?? "").trim();
  const nextActive = String(formData.get("active") ?? "") === "true";
  if (!id) return { error: "Missing id." };

  const row = await updateCost(id, { active: nextActive });
  if (!row) return { error: "That cost is gone." };

  revalidatePath("/admin/analytics");
  return { success: nextActive ? "Included in totals." : "Hidden from totals." };
}

export async function deleteCostAction(
  _prev: CostFormState,
  formData: FormData
): Promise<CostFormState> {
  await requireAdmin();

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Missing id." };

  const ok = await deleteCost(id);
  if (!ok) return { error: "That cost is already gone." };

  revalidatePath("/admin/analytics");
  return { success: "Removed." };
}
