import { apiAdmin } from "@/lib/auth";
import { logEvent, logError } from "@/lib/events";
import { reconcileAll } from "@/lib/reconcile";

/**
 * Reconcile everybody, now.
 *
 * The worker already does this every few minutes; this is for when you do not want to wait —
 * after fixing a credential, or after a Stripe outage. Safe to press repeatedly, because
 * applyEntitlement recomputes desired state from scratch every time.
 */
export async function POST() {
  const auth = await apiAdmin();
  if (!auth.ok) return auth.response;

  try {
    const result = await reconcileAll();

    await logEvent({
      type: "admin_action",
      actor: `admin:${auth.user.id}`,
      userId: auth.user.id,
      email: auth.user.email,
      message: `${auth.user.email} reconciled everyone`,
      detail: { ...result },
    });

    return Response.json({ ok: true, ...result });
  } catch (err) {
    await logError("manual reconcile failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: "Reconcile failed. Check the activity log." }, { status: 502 });
  }
}
