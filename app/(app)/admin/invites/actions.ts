"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { generateAdminInvite, revokeAdminInvite } from "@/lib/referrals";
import { logEvent } from "@/lib/events";

/**
 * Server actions for the admin invites page.
 *
 * Both re-check requireAdmin — the page-level layout guard doesn't cover server actions
 * that a form POST could hit directly. Every mint + revoke is audit-logged as an
 * admin_action with the admin's email so the origin of any invite is traceable.
 */

export type MintResult = { ok: true; code: string } | { ok: false; error: string };
export type RevokeResult = { ok: true } | { ok: false; error: string };

export async function generateAdminInviteAction(): Promise<MintResult> {
  const admin = await requireAdmin();

  try {
    const link = await generateAdminInvite(admin.id);

    await logEvent({
      type: "admin_action",
      severity: "info",
      actor: `admin:${admin.id}`,
      userId: admin.id,
      email: admin.email,
      message: `admin ${admin.email} minted admin invite ${link.code}`,
      detail: { linkId: link.id, code: link.code, kind: "admin_invite" },
    });

    revalidatePath("/admin/invites");
    return { ok: true, code: link.code };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't mint invite." };
  }
}

export async function revokeAdminInviteAction(linkId: string): Promise<RevokeResult> {
  const admin = await requireAdmin();

  if (!linkId) return { ok: false, error: "Missing link id." };

  try {
    const revoked = await revokeAdminInvite(admin.id, linkId);
    if (!revoked) {
      return { ok: false, error: "That invite is already used, expired, or gone." };
    }

    await logEvent({
      type: "admin_action",
      severity: "info",
      actor: `admin:${admin.id}`,
      userId: admin.id,
      email: admin.email,
      message: `admin ${admin.email} revoked admin invite ${linkId}`,
      detail: { linkId, kind: "admin_invite" },
    });

    revalidatePath("/admin/invites");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't revoke." };
  }
}
