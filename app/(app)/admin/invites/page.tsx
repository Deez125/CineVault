import type { Metadata } from "next";
import { headers } from "next/headers";
import { PageHeader } from "@/components/app/page-header";
import { requireAdmin } from "@/lib/auth";
import { listAdminInvites } from "@/lib/referrals";
import { env } from "@/lib/env";
import { AdminInvitesClient } from "./invites-client";

export const metadata: Metadata = { title: "Invite links" };

// Invite state changes on every click of Generate / Revoke; a stale cached render would
// show the previous list and hide the freshly-copied code.
export const dynamic = "force-dynamic";

/**
 * The admin's own invite links — separate concept from the member referral system.
 *
 * Same table underneath (kind='admin_invite'), completely different accounting: satisfies
 * the invite-only signup gate, does NOT trigger the referee discount, does NOT credit
 * anyone. Use to add specific people (a friend, a beta tester) without giving them the
 * half-price first month a member referral would.
 */
export default async function AdminInvitesPage() {
  const admin = await requireAdmin();
  const invites = await listAdminInvites(admin.id);

  // Origin computed here (not in the browser) so the copied link is right for whatever
  // env this deploy actually runs on — dev, staging, or prod — without a client-side guess.
  const host = (await headers()).get("host");
  const origin = env.APP_URL || (host ? `https://${host}` : "");

  return (
    <>
      <PageHeader
        title="Invite links"
        subtitle="Add specific people without giving them the referral discount"
        badge={invites.length}
      />

      <AdminInvitesClient
        invites={invites.map((i) => ({
          ...i,
          createdAt: i.createdAt.toISOString(),
          expiresAt: i.expiresAt.toISOString(),
          usedAt: i.usedAt?.toISOString() ?? null,
        }))}
        origin={origin}
      />
    </>
  );
}
