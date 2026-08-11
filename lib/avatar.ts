import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Upload an avatar for a user and return its public URL, with a cache-buster appended so
 * every browser and CDN sees the update.
 *
 * One file per user at `<user_id>/avatar` in the `avatars` bucket, upserted. The path has
 * no extension deliberately — Storage stores the raw bytes and serves the recorded
 * Content-Type, and using a fixed path means we do not have to hunt down and delete an
 * older extension when a user switches from JPEG to PNG.
 */
export const MAX_AVATAR_BYTES = 10 * 1024 * 1024;

/**
 * The set the file input's accept attribute claims and the set we actually accept. These
 * must stay in step or an obedient browser hides valid files while a hostile one gets away
 * with anything the accept string missed.
 */
export const ALLOWED_AVATAR_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export type AvatarValidationError =
  | { kind: "too_large" }
  | { kind: "wrong_type" };

/** Cheap up-front check so we can bail before reading the bytes. */
export function validateAvatarFile(file: File): AvatarValidationError | null {
  if (file.size > MAX_AVATAR_BYTES) return { kind: "too_large" };
  if (!ALLOWED_AVATAR_MIMES.has(file.type)) return { kind: "wrong_type" };
  return null;
}

/** Human-readable message for one of the errors above. */
export function avatarErrorMessage(err: AvatarValidationError): string {
  switch (err.kind) {
    case "too_large":
      return "That image is larger than 10 MB. Try a smaller one.";
    case "wrong_type":
      return "That format isn't supported. Use PNG, JPEG or WebP.";
  }
}

/**
 * Do the actual upload. Bypasses RLS via the service-role client; the browser never talks
 * to Storage directly, so the bucket does not need per-user policies for a caller that
 * shouldn't have had access anyway.
 */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const path = `${userId}/avatar`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error } = await supabaseAdmin.storage.from("avatars").upload(path, bytes, {
    upsert: true,
    contentType: file.type,
  });

  if (error) throw new Error(`storage upload failed: ${error.message}`);

  const {
    data: { publicUrl },
  } = supabaseAdmin.storage.from("avatars").getPublicUrl(path);

  // Cache-buster: without it the same URL returns yesterday's picture from every browser
  // and CDN that saw the old one, sometimes for hours.
  return `${publicUrl}?v=${Date.now()}`;
}
