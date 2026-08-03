import { z } from "zod";
import { apiUser } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { applyEntitlement } from "@/lib/entitlements";
import { logError, logEvent } from "@/lib/events";
import { tierForPrice } from "@/lib/stripe/tiers";
import {
  NoSubscriptionError,
  cancelPlan,
  changePlan,
  finishCardUpdate,
  getSubscriptionDetail,
  previewChange,
  StripeCardDeclinedError,
  resumePlan,
  startCardUpdate,
} from "@/lib/stripe/subscription";

/**
 * Plan management.
 *
 * The user always comes from the SESSION, never the request body. If the client could name
 * the account, anyone could cancel or downgrade somebody else's subscription by id.
 *
 * Every mutation ends by running applyEntitlement, so the change is reflected immediately
 * rather than waiting for the webhook to circle back. The webhook will also run and reach the
 * same conclusion, which is fine: the one door is idempotent by design.
 */

const ACTIONS = new Set(["preview", "change", "cancel", "resume", "card"]);

export async function GET() {
  const auth = await apiUser();
  if (!auth.ok) return auth.response;

  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "not signed in" }, { status: 401 });

  try {
    const detail = await getSubscriptionDetail(user);
    if (!detail) return Response.json({ error: "no subscription" }, { status: 404 });
    return Response.json(detail);
  } catch (err) {
    await logError("could not read subscription", {
      error: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: "could not read your subscription" }, { status: 502 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ action?: string[] }> }
) {
  const auth = await apiUser();
  if (!auth.ok) return auth.response;

  const { action } = await params;
  const verb = action?.[0];

  if (!verb || !ACTIONS.has(verb)) {
    return Response.json({ error: "unknown action" }, { status: 404 });
  }

  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "not signed in" }, { status: 401 });

  const body = await request.json().catch(() => ({}));

  try {
    switch (verb) {
      case "preview": {
        const priceId = requirePrice(body);
        if (!(await tierForPrice(priceId))) {
          return Response.json({ error: "unknown plan" }, { status: 400 });
        }
        return Response.json(await previewChange(user, priceId));
      }

      case "change": {
        const priceId = requirePrice(body);
        const tier = await tierForPrice(priceId);
        if (!tier) return Response.json({ error: "unknown plan" }, { status: 400 });

        const { clientSecret } = await changePlan(user, priceId);

        // The card needs the holder to confirm. NOTHING has changed yet — the plan swaps
        // only once that confirmation succeeds and Stripe applies the pending update, which
        // arrives here as a webhook. Deliberately does not touch entitlement: granting on the
        // strength of an unpaid invoice is the whole thing this design avoids.
        if (clientSecret) {
          return Response.json({ ok: false, requiresAction: true, clientSecret });
        }

        // Re-derived rather than judged from the object above, so the same rule applies here
        // as in the webhook. See the note on ApplyOptions.
        const result = await applyEntitlement(user.id, { actor: "user" });

        return Response.json({ ok: true, streamLimit: result?.streamLimit ?? tier.streams });
      }

      case "cancel": {
        const subscription = await cancelPlan(user);
        await applyEntitlement(user.id, { subscription, actor: "user" });
        return Response.json({ ok: true });
      }

      case "resume": {
        const subscription = await resumePlan(user);
        await applyEntitlement(user.id, { subscription, actor: "user" });
        return Response.json({ ok: true });
      }

      case "card": {
        // Two-step. No payment method id yet means "give me a SetupIntent to confirm";
        // with one means "that card is saved, now point the subscription at it".
        const paymentMethodId = typeof body.paymentMethodId === "string" ? body.paymentMethodId : null;

        if (!paymentMethodId) {
          return Response.json({ clientSecret: await startCardUpdate(user) });
        }

        await finishCardUpdate(user, paymentMethodId);
        await logEvent({
          type: "admin_action",
          actor: "user",
          userId: user.id,
          email: user.email,
          message: `${user.email} updated their card`,
        });
        return Response.json({ ok: true });
      }
    }
  } catch (err) {
    if (err instanceof NoSubscriptionError) {
      return Response.json({ error: err.message, code: err.code }, { status: 409 });
    }
    if (err instanceof BadRequest) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    // A refused card is the customer's problem to fix, not a fault worth logging as an error
    // and not something to hide behind "that didn't work". 402 is the honest status, and the
    // message already says the plan is unchanged.
    if (err instanceof StripeCardDeclinedError) {
      return Response.json({ error: err.message, code: err.code }, { status: 402 });
    }

    await logError(
      `subscription/${verb} failed`,
      { error: err instanceof Error ? err.message : String(err) },
      { userId: user.id, email: user.email, actor: "user" }
    );

    return Response.json({ error: "That didn't work. Try again." }, { status: 502 });
  }

  return Response.json({ error: "unknown action" }, { status: 404 });
}

class BadRequest extends Error {}

function requirePrice(body: unknown): string {
  const parsed = z.object({ priceId: z.string().min(1) }).safeParse(body);
  if (!parsed.success) throw new BadRequest("priceId required");
  return parsed.data.priceId;
}
