import { z } from "zod";
import { apiAdmin } from "@/lib/auth";
import { getUser } from "@/lib/admin";
import { logError } from "@/lib/events";
import {
  ADMIN_ACTIONS,
  AdminActionError,
  adminBan,
  adminReconcile,
  adminReinvite,
  adminRevoke,
  adminUnban,
  adminUnlinkPlex,
  type AdminAction,
} from "@/lib/admin-actions";
import { ProtectedUserError } from "@/lib/plex/protected";

/**
 * Admin actions on one member.
 *
 * `apiAdmin()` answers 404 rather than 403 to anyone who is not an admin, so this endpoint
 * does not confirm its own existence to somebody probing for it. The check runs HERE, on the
 * data route — gating only the admin pages would be theatre, because these would still
 * answer.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; action: string }> }
) {
  const auth = await apiAdmin();
  if (!auth.ok) return auth.response;

  const { id, action } = await params;

  if (!(ADMIN_ACTIONS as readonly string[]).includes(action)) {
    return Response.json({ error: "unknown action" }, { status: 404 });
  }

  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "bad id" }, { status: 400 });
  }

  const target = await getUser(id);
  if (!target) return Response.json({ error: "no such user" }, { status: 404 });

  // An admin revoking or banning themselves would lock the door with the keys inside.
  const destructive = ["revoke", "ban"].includes(action);
  if (destructive && target.id === auth.user.id) {
    return Response.json(
      { error: "You can't do that to your own account." },
      { status: 400 }
    );
  }

  const ctx = { adminId: auth.user.id, adminEmail: auth.user.email };
  const body = await request.json().catch(() => ({}));

  try {
    switch (action as AdminAction) {
      case "revoke":
        return Response.json({ ok: true, ...(await adminRevoke(target, ctx)) });

      case "ban": {
        const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : null;
        await adminBan(target, reason, ctx);
        return Response.json({ ok: true });
      }

      case "unban":
        await adminUnban(target, ctx);
        return Response.json({ ok: true });

      case "reinvite":
        await adminReinvite(target, ctx);
        return Response.json({ ok: true });

      case "unlink":
        await adminUnlinkPlex(target, ctx);
        return Response.json({ ok: true });

      case "reconcile":
        return Response.json({ ok: true, ...(await adminReconcile(target, ctx)) });
    }
  } catch (err) {
    // Both of these are the admin's to read and act on, not server faults to bury.
    if (err instanceof AdminActionError || err instanceof ProtectedUserError) {
      return Response.json({ error: err.message }, { status: 409 });
    }

    await logError(
      `admin action ${action} failed`,
      { error: err instanceof Error ? err.message : String(err), targetId: id },
      { userId: target.id, email: target.email, actor: `admin:${auth.user.id}` }
    );

    return Response.json({ error: "That didn't work. Check the activity log." }, { status: 502 });
  }
}
