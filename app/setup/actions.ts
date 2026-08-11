"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getSupabaseServer } from "@/lib/supabase/server";
import { USERNAME_MAX, USERNAME_MIN, checkUsername } from "@/lib/display-name";
import {
  avatarErrorMessage,
  uploadAvatar,
  validateAvatarFile,
} from "@/lib/avatar";
import { logError } from "@/lib/events";

/**
 * The one-time profile setup submission.
 *
 * Runs when the visitor submits the /setup form. Everything is validated server-side —
 * the client-side check is UX, not enforcement — and the avatar upload happens with the
 * service-role Supabase client so the browser never talks to Storage directly. That lets us
 * cap size, sniff the mimetype, and reject files that pass the accept attribute but are
 * actually something else (Content-Type is spoofable client-side).
 *
 * Two writes together:
 *   1. our `users` row: names, username, avatar_url, setup_complete = true
 *   2. Supabase Auth user_metadata: setup_complete = true
 *
 * The DB is the source of truth; the metadata copy exists so the proxy can decide whether
 * to gate a request from the JWT alone, without an extra roundtrip per request. Setting
 * both in the same action keeps them in step — a stale metadata copy would send the visitor
 * back to /setup on their very next click.
 */

export type SetupState = { error?: string } | null;

const nameSchema = z
  .string()
  .trim()
  .min(1, "This is required.")
  .max(60, "Keep it under 60 characters.");

export async function setupAction(
  _prev: SetupState,
  formData: FormData
): Promise<SetupState> {
  const supabase = await getSupabaseServer();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    // Someone submitted this without a session — cookie expired, browser tab was left open,
    // whatever. Send them to sign back in.
    redirect("/login?next=/setup");
  }

  const parsed = z
    .object({
      firstName: nameSchema,
      lastName: nameSchema,
      username: z
        .string()
        .trim()
        .min(USERNAME_MIN)
        .max(USERNAME_MAX),
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

  const usernameProblem = checkUsername(username);
  if (usernameProblem) return { error: usernameProblem };

  // ── Avatar (optional) ────────────────────────────────────────────────────
  const avatarFile = formData.get("avatar");
  let avatarUrl: string | null = null;

  if (avatarFile instanceof File && avatarFile.size > 0) {
    const problem = validateAvatarFile(avatarFile);
    if (problem) return { error: avatarErrorMessage(problem) };

    try {
      avatarUrl = await uploadAvatar(authUser.id, avatarFile);
    } catch (err) {
      await logError(
        "avatar upload failed at /setup",
        { error: err instanceof Error ? err.message : String(err) },
        { userId: authUser.id, actor: "user" }
      );
      return { error: "We couldn't save that photo. Try again in a moment." };
    }
  }

  // ── DB write ─────────────────────────────────────────────────────────────
  try {
    await db
      .update(users)
      .set({
        firstName,
        lastName,
        username,
        ...(avatarUrl !== null ? { avatarUrl } : {}),
        setupComplete: true,
        updatedAt: new Date(),
      })
      .where(eq(users.id, authUser.id));
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { error: "That username is taken." };
    }
    throw err;
  }

  // ── Auth metadata mirror ─────────────────────────────────────────────────
  // The proxy reads `setup_complete` from the JWT to gate every request; updating the auth
  // user's metadata bumps that flag AND refreshes the current session's tokens so the very
  // next request has the new value in hand.
  const { error: metaError } = await supabase.auth.updateUser({
    data: { setup_complete: true, username, first_name: firstName, last_name: lastName },
  });

  if (metaError) {
    await logError(
      "supabase updateUser failed after /setup",
      { error: metaError.message },
      { userId: authUser.id, actor: "user" }
    );
    // The DB write succeeded — they are functionally set up. The metadata sync is a cache
    // for the proxy's benefit and the fallback DB check in getSessionUser catches this
    // case; a redirect loop is not possible.
  }

  redirect("/dashboard");
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
