import type { Metadata } from "next";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageHeader } from "@/components/app/page-header";
import { PlexClient } from "./plex-client";
import { requireUser } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { getSharedLibraries } from "@/lib/plex/client";

export const metadata: Metadata = { title: "Plex" };

const ERRORS: Record<string, string> = {
  expired: "That took too long. Start again.",
  not_authorised: "Plex didn't confirm the sign-in. Try again.",
  unavailable: "Plex linking isn't available right now.",
  rate_limited: "Too many attempts. Wait a few minutes.",
  failed: "Something went wrong talking to Plex. Try again.",
};

export default async function PlexPage({
  searchParams,
}: {
  searchParams: Promise<{ linked?: string; error?: string; message?: string }>;
}) {
  await requireUser("/dashboard/plex");
  const user = await getCurrentUser();
  if (!user) return null;

  const params = await searchParams;
  const error = params.error
    ? params.message || ERRORS[params.error] || "That didn't work. Try again."
    : null;

  // Read from Plex, cached for ten minutes, and degrades to an empty list rather than taking
  // the page down when Plex is unreachable.
  const libraries = await getSharedLibraries();

  return (
    <>
      <PageHeader title="Plex" subtitle="The account you watch on" />

      {error && (
        <Alert variant="destructive" className="mb-5">
          <TriangleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {params.linked && !error && (
        <Alert className="mb-5">
          <CircleCheck className="text-success" />
          <AlertDescription>
            Linked as {user.plexUsername}.{" "}
            {user.shareState === "invited"
              ? "Your invite is on its way. Accept it at app.plex.tv."
              : user.isMember
                ? "Setting up your access now."
                : "Your invite goes out as soon as you have a plan."}
          </AlertDescription>
        </Alert>
      )}

      <PlexClient
        state={{
          plexUsername: user.plexUsername,
          shareState: user.shareState,
          isMember: user.isMember,
          streamLimit: user.streamLimit,
        }}
        libraries={libraries.map((l) => ({ id: l.id, title: l.title, type: l.type }))}
      />
    </>
  );
}
