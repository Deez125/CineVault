import type { Metadata } from "next";
import { Play } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { PlexClient } from "./plex-client";
import { requireUser } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Plex" };

export default async function PlexPage() {
  await requireUser("/dashboard/plex");
  const user = await getCurrentUser();
  if (!user) return null;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        icon={Play}
        title="Plex"
        subtitle="The account you watch on"
      />

      <PlexClient
        state={{
          plexUsername: user.plexUsername,
          shareState: user.shareState,
          isMember: user.isMember,
        }}
      />
    </div>
  );
}
