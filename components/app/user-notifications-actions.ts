"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { markNotificationRead } from "@/lib/notifications";

export type DismissState = { error?: string; dismissed?: true } | null;

/**
 * Dismiss one notification. Requires the caller's user id AND the notification id, and
 * markNotificationRead's WHERE requires both to match — so a copy-pasted id from another
 * account is a no-op, not a way to silently mark somebody else's banner read.
 */
export async function dismissNotificationAction(
  _prev: DismissState,
  formData: FormData
): Promise<DismissState> {
  const user = await requireUser();

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Missing id." };

  const ok = await markNotificationRead(id, user.id);
  if (!ok) {
    // Either already read, or the id doesn't belong to them. Either way, dropping the card
    // locally is the right client-side response.
    return { dismissed: true };
  }

  revalidatePath("/dashboard");
  return { dismissed: true };
}
