"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getUser } from "@/lib/admin";
import { adminAwardCredit, adminSetCredit } from "@/lib/admin/profile-actions";
import { invalidateLiveMetricsCache } from "@/lib/analytics/stripe-live";
import { AdminActionError } from "@/lib/admin-actions";

/**
 * Server actions for the per-user admin profile page.
 *
 * Every action:
 *   1. requireAdmin() — page-level gate doesn't cover server actions.
 *   2. Loads the target user by uuid from the form.
 *   3. Calls the corresponding function in lib/admin/profile-actions.
 *   4. Busts the analytics Stripe cache — otherwise the credit balance shown on the
 *      analytics popup would stay stale for up to a minute.
 *   5. Revalidates the profile path so the render after the action reflects the new state.
 */

export type ProfileFormState = { error?: string; success?: string } | null;

function parseAmount(raw: FormDataEntryValue | null): number | null {
  if (raw === null) return null;
  const cleaned = String(raw).replace(/[^0-9.-]/g, "").trim();
  if (!cleaned) return null;
  const dollars = Number(cleaned);
  if (!Number.isFinite(dollars)) return null;
  return Math.round(dollars * 100);
}

export async function awardCreditAction(
  _prev: ProfileFormState,
  formData: FormData
): Promise<ProfileFormState> {
  const admin = await requireAdmin();

  const userId = String(formData.get("userId") ?? "").trim();
  const amount = parseAmount(formData.get("amount"));
  const reason = String(formData.get("reason") ?? "").trim() || null;

  if (!userId) return { error: "Missing user id." };
  if (amount === null || amount <= 0) {
    return { error: "Enter a positive dollar amount." };
  }

  const target = await getUser(userId);
  if (!target) return { error: "That user is gone." };

  try {
    const result = await adminAwardCredit(
      target,
      amount,
      reason,
      { adminId: admin.id, adminEmail: admin.email }
    );
    invalidateLiveMetricsCache();
    revalidatePath(`/admin/profile/${userId}`);
    return {
      success: `Credited. New balance $${(result.balanceCentsAfter / 100).toFixed(2)}.`,
    };
  } catch (err) {
    if (err instanceof AdminActionError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Couldn't award credit." };
  }
}

export async function setCreditAction(
  _prev: ProfileFormState,
  formData: FormData
): Promise<ProfileFormState> {
  const admin = await requireAdmin();

  const userId = String(formData.get("userId") ?? "").trim();
  const absolute = parseAmount(formData.get("amount"));
  const reason = String(formData.get("reason") ?? "").trim() || null;

  if (!userId) return { error: "Missing user id." };
  if (absolute === null || absolute < 0) {
    return { error: "Enter a zero-or-positive dollar amount." };
  }

  const target = await getUser(userId);
  if (!target) return { error: "That user is gone." };

  try {
    const result = await adminSetCredit(
      target,
      absolute,
      reason,
      { adminId: admin.id, adminEmail: admin.email }
    );
    invalidateLiveMetricsCache();
    revalidatePath(`/admin/profile/${userId}`);
    if (result.deltaCents === 0) return { success: "Already at that balance — no change." };
    return {
      success: `Balance set to $${(result.balanceCentsAfter / 100).toFixed(2)}.`,
    };
  } catch (err) {
    if (err instanceof AdminActionError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Couldn't adjust balance." };
  }
}
