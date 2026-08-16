import type { Metadata } from "next";

import { PageHeader } from "@/components/app/page-header";
import { SettingsClient } from "./settings-client";
import { requireUser } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { listMySessions } from "@/lib/auth/sessions";
import { logError } from "@/lib/events";
import { emailVerificationRequired } from "@/lib/email";
import type { SessionRow } from "./sessions-section";

// This page reads live auth session state on every render — no cache. The "signed-in
// devices" list needs to reflect what actually exists right now, not what existed when a
// build ran or when a stale prerender was captured.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireUser("/dashboard/settings");
  const user = await getCurrentUser();
  if (!user) return null;

  const sessions = await listMySessions(user.id)
    .then((rows): SessionRow[] =>
      rows.map((s) => ({
        // ISO strings across the server/client boundary — Date instances don't survive.
        id: s.id,
        createdAt: s.createdAt.toISOString(),
        refreshedAt: s.refreshedAt?.toISOString() ?? null,
        userAgent: s.userAgent,
        ip: s.ip,
        isCurrent: s.isCurrent,
      }))
    )
    .catch((err) => {
      // A settings page that 500s because the sessions API had a hiccup is a worse outcome
      // than one that quietly omits the section. Log and continue.
      void logError(
        "listMySessions failed on settings page",
        { error: err instanceof Error ? err.message : String(err) },
        { userId: user.id, email: user.email, actor: "user" }
      );
      return [] as SessionRow[];
    });

  return (
    <>
      <PageHeader title="Settings" subtitle="Your account" />

      <SettingsClient
        email={user.email}
        firstName={user.firstName}
        lastName={user.lastName}
        username={user.username}
        avatarUrl={user.avatarUrl}
        // Decided on the server: with no mail provider there is nothing to confirm, so the
        // whole confirmation UI is hidden rather than showing a permanent "Not confirmed"
        // badge next to a button that cannot help.
        showVerification={emailVerificationRequired()}
        emailVerified={Boolean(user.emailVerifiedAt)}
        isMember={user.isMember}
        sessions={sessions}
      />
    </>
  );
}
