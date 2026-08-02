import type { Metadata } from "next";
import { Settings } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { SettingsClient } from "./settings-client";
import { requireUser } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireUser("/dashboard/settings");
  const user = await getCurrentUser();
  if (!user) return null;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader icon={Settings} title="Settings" subtitle="Your account" />

      <SettingsClient
        email={user.email}
        name={user.name}
        emailVerified={Boolean(user.emailVerifiedAt)}
        isMember={user.isMember}
      />
    </div>
  );
}
