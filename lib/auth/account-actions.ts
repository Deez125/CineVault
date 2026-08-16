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
import { USERNAME_MAX, checkUsername } from "@/lib/display-name";
import { getCurrentUser } from "./session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  avatarErrorMessage,
  uploadAvatar,
  validateAvatarFile,
} from "@/lib/avatar";
import { revokeSession } from "./sessions";
import type { FormState } from "./actions";

/** Account settings: name, password, and closing the account. */

const MIN_PASSWORD_LENGTH = 8;

export async function updateProfileAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in first." };

  const parsed = z
    .object({
      firstName: z.string().trim().max(60),
      lastName: z.string().trim().max(60),
      username: z.string().trim().max(USERNAME_MAX),
    })
    .safeParse({
      firstName: formData.get("firstName") ?? "",
      lastName: formData.get("lastName") ?? "",
      username: formData.get("username") ?? "",
    });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const { firstName, lastName, username } = parsed.data;

  // Empty clears it. Only validate the shape when there is something to validate, or somebody
  // who never wanted a username could never save their first name either.
  if (username) {
    const problem = checkUsername(username);
    if (problem) return { error: problem };
  }

  try {
    await db
      .update(users)
      .set({
        firstName: firstName || null,
        lastName: lastName || null,
        username: username || null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));
  } catch (err) {
    // The unique index is case-insensitive, so this fires for "JoMat" when "jomat" exists.
    // Checking first and then writing would still race two people to the same handle; letting
    // the database be the one to decide cannot.
    if (isUniqueViolation(err)) {
      return { error: "That username is taken." };
    }
    throw err;
  }

  revalidatePath("/dashboard/settings");
  return { success: "Saved." };
}

/**
 * Change the profile picture from the settings page.
 *
 * A separate action from updateProfileAction because the file input UX submits on select
 * rather than waiting for a Save button, and mixing that flow with the name/username form's
 * submit-on-save would either double-post or make the picture change silently on cancel.
 */
export async function updateAvatarAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in first." };

  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose an image to upload." };
  }

  const problem = validateAvatarFile(file);
  if (problem) return { error: avatarErrorMessage(problem) };

  let avatarUrl: string;
  try {
    avatarUrl = await uploadAvatar(user.id, file);
  } catch (err) {
    await logError(
      "avatar upload failed at /dashboard/settings",
      { error: err instanceof Error ? err.message : String(err) },
      { userId: user.id, actor: "user" }
    );
    return { error: "We couldn't save that photo. Try again in a moment." };
  }

  await db
    .update(users)
    .set({ avatarUrl, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  revalidatePath("/dashboard/settings");
  return { success: "Photo updated." };
}

/**
 * End one signed-in session for the current user.
 *
 * Handles the "sign me out on that laptop I forgot about" case from the settings page. The
 * session id comes from listMySessions on the same page; passing user.id here as the
 * required match means a copy-pasted id from anyone else's session cannot revoke it.
 */
export async function revokeSessionAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in first." };

  const sessionId = String(formData.get("sessionId") ?? "").trim();
  if (!sessionId) return { error: "Missing session id." };

  try {
    await revokeSession(sessionId, user.id);
  } catch (err) {
    await logError(
      "revokeSession failed",
      { error: err instanceof Error ? err.message : String(err), sessionId },
      { userId: user.id, email: user.email, actor: "user" }
    );
    return { error: "That didn't work. Try again." };
  }

  revalidatePath("/dashboard/settings");
  return { success: "Signed out on that device." };
}

/** SQLSTATE 23505, anywhere in the cause chain. Drizzle wraps the driver's error. */
function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;

  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current === "object" && "code" in current && current.code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

/**
 * Change password from the account settings page.
 *
 * The current password is required even though the visitor is already signed in — a borrowed
 * laptop with a live session must not be enough to lock the real owner out. Supabase's SDK
 * has no "verify current password" primitive, so we reauthenticate by attempting a fresh
 * sign-in with the address on the session and the current password; failure is treated as
 * an incorrect current password.
 *
 * After the change every OTHER refresh token is invalidated by Supabase itself; the caller
 * stays signed in on this device because updateUser refreshes the current session's tokens
 * as part of the same call.
 */
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

  const supabase = await getSupabaseServer();

  // Reauthenticate. signInWithPassword succeeds without writing to state — it just returns
  // the tokens — but we don't have to persist them; the current session on this call is
  // already the one we care about, and it will pick up the new password below.
  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: parsed.data.current,
  });
  if (verifyError) {
    return { error: "That's not your current password." };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.next });
  if (error) return { error: error.message };

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
 *   3. Delete the auth.users row. The FK cascade removes public.users too.
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

  // Reauthenticate with the current password before doing anything destructive. Same reason
  // as changePassword: a live session on a borrowed device must not be a delete button.
  const password = String(formData.get("password") ?? "");
  const supabase = await getSupabaseServer();
  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password,
  });
  if (verifyError) {
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

  // Logged BEFORE the delete. The event's user_id is set null by the foreign key on cascade,
  // and the denormalised email and Plex username are what keep the record readable afterwards.
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

  // Delete on the AUTH side; the FK from public.users(id) → auth.users(id) with ON DELETE
  // CASCADE removes our profile row automatically. Doing it in this order also invalidates
  // every session Supabase issued — a stale cookie can't outlive the identity it referred to.
  const { error } = await supabaseAdmin.auth.admin.deleteUser(user.id);
  if (error) {
    await logError(
      "account deletion failed at supabase.auth.admin.deleteUser",
      { error: error.message },
      { userId: user.id, email: user.email, actor: "user" }
    );
    return {
      error: "Something went wrong deleting the account. Try again shortly, or contact support.",
    };
  }

  redirect("/?deleted=1");
}
