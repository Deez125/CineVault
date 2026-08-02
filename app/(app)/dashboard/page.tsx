import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Overview" };

/**
 * Placeholder.
 *
 * The real dashboard is the sidebar shell modelled on the reference layout: announcement
 * banner, recently-added strip, the server card, referral banner. This exists so the auth
 * flow has somewhere to land while that is built.
 */
export default async function DashboardPage() {
  await requireUser("/dashboard");
  const user = await getCurrentUser();

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Signed in</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The dashboard shell is next. For now, here is what the server knows about you.
      </p>

      <dl className="mt-8 divide-y rounded-xl border bg-card text-sm">
        {[
          ["Email", user?.email],
          ["Email confirmed", user?.emailVerifiedAt ? "yes" : "no"],
          ["Admin", user?.isAdmin ? "yes" : "no"],
          ["Subscribed", user?.isMember ? "yes" : "no"],
          ["Concurrent users", String(user?.streamLimit ?? 0)],
          ["Plex", user?.plexUsername ?? "not linked"],
          ["Share state", user?.shareState ?? "none"],
        ].map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 px-5 py-3">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
