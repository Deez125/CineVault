import type { Metadata } from "next";

import { PageHeader } from "@/components/app/page-header";
import { SettingsClient } from "./settings-client";
import { requireUser } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { emailVerificationRequired } from "@/lib/email";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireUser("/dashboard/settings");
  const user = await getCurrentUser();
  if (!user) return null;

  return (
    <>
      <PageHeader title="Settings" subtitle="Your account" />

      <SettingsClient
        email={user.email}
        firstName={user.firstName}
        lastName={user.lastName}
        username={user.username}
        // Decided on the server: with no mail provider there is nothing to confirm, so the
        // whole confirmation UI is hidden rather than showing a permanent "Not confirmed"
        // badge next to a button that cannot help.
        showVerification={emailVerificationRequired()}
        emailVerified={Boolean(user.emailVerifiedAt)}
        isMember={user.isMember}
      />
    </>
  );
}
