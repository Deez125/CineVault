"use server";

import { revalidatePath } from "next/cache";
import { isMemberOrAdmin } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { LinkCapError, generateLink, revokeLink } from "@/lib/referrals";
import { logEvent } from "@/lib/events";

/**
 * Minting and killing invites.
 *
 * Both take the user from the session and nothing from the form. A link id arriving from the
 * browser is only ever a claim about WHICH link; who owns it is decided here, and the
 * ownership test lives inside the UPDATE rather than in a check before it.
 */

export type ActionResult = { ok: true; code?: string } | { ok: false; error: string };

export async function generateLinkAction(): Promise<ActionResult> {
  const user = await getCurrentUser();
  // Members only, same as the page. Inviting is something a plan buys, and a referrer with
  // no Stripe customer cannot be credited when their invite pays out.
  if (!user || !isMemberOrAdmin(user)) return { ok: false, error: "Not available." };

  try {
    const link = await generateLink(user.id);

    await logEvent({
      type: "admin_action",
      actor: "user",
      userId: user.id,
      email: user.email,
      message: `${user.email} generated an invite link`,
      detail: { linkId: link.id, expiresAt: link.expiresAt.toISOString() },
    });

    revalidatePath("/dashboard/referrals");
    return { ok: true, code: link.code };
  } catch (err) {
    if (err instanceof LinkCapError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function revokeLinkAction(linkId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || !isMemberOrAdmin(user)) return { ok: false, error: "Not available." };

  // Same message whether the link belongs to somebody else, was already used, or never
  // existed. Distinguishing them would turn this into a way to probe for valid link ids.
  const done = await revokeLink(user.id, linkId);
  if (!done) return { ok: false, error: "That invite can't be revoked." };

  revalidatePath("/dashboard/referrals");
  return { ok: true };
}
