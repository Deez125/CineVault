import type { Metadata } from "next";
import { CircleCheck, CircleX, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageHeader } from "@/components/app/page-header";
import { ServiceSettingsClient } from "./service-settings-client";
import { emailConfigured, emailVerificationRequired } from "@/lib/email";
import { env, isProduction, plexConfigured, protectedPlexUsers, tracearrConfigured } from "@/lib/env";
import { isLiveMode } from "@/lib/stripe/client";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Service settings" };

/**
 * How the service is wired up.
 *
 * Shows STATE, not secrets. No key, token or connection string reaches this page — an admin
 * needs to know whether Stripe is configured, not what the key is, and a panel that displays
 * credentials turns one compromised admin session into a compromised everything.
 *
 * Nothing here is editable either. Configuration lives in the environment and changing it is
 * a deploy, deliberately: a settings page that can switch Stripe to live mode from a browser
 * is one misclick from charging real cards.
 */
export default async function ServiceSettingsPage() {
  const integrations = [
    {
      name: "Stripe",
      ok: true,
      detail: isLiveMode ? "LIVE mode — real cards" : "Test mode — no real money",
      warn: isLiveMode && !isProduction,
      warning: "A live key outside production. Real cards can be charged from here.",
    },
    {
      name: "Stripe webhook",
      ok: Boolean(env.STRIPE_WEBHOOK_SECRET),
      detail: env.STRIPE_WEBHOOK_SECRET
        ? "Configured"
        : "Missing — payments succeed and nobody is granted access",
    },
    {
      name: "Plex",
      ok: plexConfigured(),
      detail: plexConfigured()
        ? "Configured"
        : "Missing — nobody can be granted or revoked access",
    },
    {
      name: "Tracearr",
      ok: tracearrConfigured(),
      detail: tracearrConfigured()
        ? "Configured — stream limits enforced"
        : "Missing — stream limits are not enforced",
    },
    {
      name: "Email",
      ok: emailConfigured(),
      detail: emailConfigured()
        ? "Configured"
        : "Missing — password reset cannot work",
    },
    {
      name: "Email verification",
      ok: emailVerificationRequired(),
      detail: emailVerificationRequired() ? "Required at signup" : "Off",
      neutral: true,
    },
  ];

  const broken = integrations.filter((i) => !i.ok && !i.neutral);

  return (
    <>
      <PageHeader title="Service settings" subtitle="How CineVault is wired up" />

      {broken.length > 0 && (
        <Alert variant="destructive" className="mb-5">
          <TriangleAlert />
          <AlertDescription>
            {broken.length} integration{broken.length === 1 ? " is" : "s are"} not configured.
            Each one below says what breaks without it.
          </AlertDescription>
        </Alert>
      )}

      <section className="mb-5 rounded-xl border bg-card">
        <div className="border-b px-5 py-3.5">
          <h2 className="text-sm font-semibold">Integrations</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Read from the environment. Changing any of it is a deploy, not a click.
          </p>
        </div>

        <ul className="divide-y">
          {integrations.map((integration) => (
            <li
              key={integration.name}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
            >
              <div className="flex items-center gap-2.5">
                {integration.neutral ? (
                  <span className="size-4 shrink-0 rounded-full border" />
                ) : integration.ok ? (
                  <CircleCheck className="size-4 shrink-0 text-success" />
                ) : (
                  <CircleX className="size-4 shrink-0 text-destructive" />
                )}
                <span className="text-sm font-medium">{integration.name}</span>
              </div>

              <span
                className={cn(
                  "text-xs",
                  integration.ok || integration.neutral
                    ? "text-muted-foreground"
                    : "text-destructive"
                )}
              >
                {integration.detail}
              </span>
            </li>
          ))}
        </ul>

        {integrations.some((i) => i.warn) && (
          <div className="border-t border-destructive/30 bg-destructive/5 px-5 py-3 text-xs text-destructive">
            {integrations.find((i) => i.warn)?.warning}
          </div>
        )}
      </section>

      <section className="mb-5 rounded-xl border bg-card">
        <div className="border-b px-5 py-3.5">
          <h2 className="text-sm font-semibold">Background loops</h2>
        </div>
        <dl className="divide-y text-sm">
          <Row
            label="Reconcile"
            value={`every ${Math.round(env.RECONCILE_INTERVAL_MS / 1000)}s`}
            hint="Heals missed webhooks by asking Stripe what's true"
          />
          <Row
            label="Enforce stream limits"
            value={
              tracearrConfigured()
                ? `every ${Math.round(env.ENFORCE_INTERVAL_MS / 1000)}s`
                : "not running"
            }
            hint="Needs Tracearr"
          />
        </dl>
      </section>

      <ServiceSettingsClient protectedCount={protectedPlexUsers().length} />
    </>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
      <div>
        <dt className="font-medium">{label}</dt>
        <dd className="text-xs text-muted-foreground">{hint}</dd>
      </div>
      <span className="text-sm tabular-nums text-muted-foreground">{value}</span>
    </div>
  );
}
