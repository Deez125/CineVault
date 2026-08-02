"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logEvent, logError } from "@/lib/events";
import { cancelImmediately } from "@/lib/stripe/subscription";
import { revokePlexAccess } from "@/lib/plex/share";
import { isProtected } from "@/lib/plex/protected";
import { plexConfigured } from "@/lib/env";
import { MIN_PASSWORD_LENGTH, hashPassword, verifyPassword } from "./password";
import { destroyAllSessions, destroySession, getCurrentUser } from "./session";
import type { FormState } from "./actions";

/** Account settings: name, password, and closing the account. */

export async function updateNameAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in first." };

  const parsed = z.string().trim().max(80).safeParse(formData.get("name") ?? "");
  if (!parsed.success) return { error: "That name is too long." };

  await db
    .update(users)
    .set({ name: parsed.data || null, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  revalidatePath("/dashboard/settings");
  return { success: "Saved." };
}

export async function changePasswordAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in first." };

  const parsed = z
    .object({
      current: z.string().min(1, "Enter your current password."),
      next: z
        .string()
        .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
        .max(200),
    })
    .safeParse({ current: formData.get("current"), next: formData.get("next") });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  // The current password is required even though they are already signed in. A borrowed
  // laptop with a live session should not be enough to lock the real owner out.
  if (!(await verifyPassword(parsed.data.current, user.passwordHash))) {
    return { error: "That's not your current password." };
  }

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(parsed.data.next), updatedAt: new Date() })
    .where(eq(users.id, user.id));

  // Every other session dies, including whoever prompted the change. Ours is reissued below
  // so they are not signed out of the device they are using.
  await destroyAllSessions(user.id);

  const { createSession } = await import("./session");
  await createSession(user.id);

  await logEvent({
    type: "admin_action",
    actor: "user",
    userId: user.id,
    email: user.email,
    message: `${user.email} changed their password`,
  });

  return { success: "Password changed. You've been signed out everywhere else." };
}

/**
 * Close the account.
 *
 * Order matters and is the whole difficulty here:
 *
 *   1. Cancel the subscription IMMEDIATELY. Skipping this leaves Stripe billing a customer
 *      whose account no longer exists, and nobody notices until the chargeback.
 *   2. Revoke the Plex share. It must happen while we still know their Plex username, so it
 *      cannot wait until after the row is gone.
 *   3. Delete the row.
 *
 * If step 1 or 2 fails, we stop and delete nothing. A half-deleted account that is still
 * being charged is far worse than one that is still there.
 */
export async function deleteAccountAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in first." };

  const confirmation = String(formData.get("confirm") ?? "").trim();
  if (confirmation.toLowerCase() !== user.email.toLowerCase()) {
    return { error: "Type your email address exactly to confirm." };
  }

  const password = String(formData.get("password") ?? "");
  if (!(await verifyPassword(password, user.passwordHash))) {
    return { error: "That password isn't right." };
  }

  try {
    if (user.stripeSubscriptionId) {
      await cancelImmediately(user);
    }
  } catch (err) {
    await logError(
      "account deletion aborted: could not cancel subscription",
      { error: err instanceof Error ? err.message : String(err) },
      { userId: user.id, email: user.email, actor: "user" }
    );
    return {
      error:
        "We couldn't cancel your subscription, so nothing was deleted. Try again in a moment.",
    };
  }

  try {
    if (user.plexUsername && user.shareState === "invited" && !isProtected(user.plexUsername)) {
      if (plexConfigured()) await revokePlexAccess(user);
    }
  } catch (err) {
    await logError(
      "account deletion aborted: could not revoke Plex access",
      { error: err instanceof Error ? err.message : String(err) },
      { userId: user.id, email: user.email, plexUsername: user.plexUsername, actor: "user" }
    );
    return {
      error: "We couldn't remove your Plex access, so nothing was deleted. Try again shortly.",
    };
  }

  // Logged BEFORE the delete. The event's user_id is set null by the foreign key, and the
  // denormalised email and Plex username are what keep the record readable afterwards.
  await logEvent({
    type: "membership_lost",
    severity: "warn",
    actor: "user",
    userId: user.id,
    email: user.email,
    plexUsername: user.plexUsername,
    message: `${user.email} deleted their account`,
    detail: { deleted: true },
  });

  await db.delete(users).where(eq(users.id, user.id));
  await destroySession();

  redirect("/?deleted=1");
}
