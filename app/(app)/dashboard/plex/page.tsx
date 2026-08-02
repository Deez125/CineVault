import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { FlashToast } from "@/components/app/flash-toast";
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

  const libraries = await getSharedLibraries();

  /**
   * Titles are only sent to people who have a plan.
   *
   * Blurring them in CSS would not do: the text would still be in the HTML, and anybody could
   * read it out of the page source in two clicks. If it should not be known, it should not be
   * sent. Non-members get the COUNT, which is a selling point rather than a leak.
   */
  const canSeeTitles = user.isMember;

  return (
    <>
      <PageHeader title="Plex" subtitle="The account you watch on" />

      <FlashToast
        message={
          error ??
          (params.linked
            ? user.shareState === "invited"
              ? `Linked as ${user.plexUsername}. Accept the invite at app.plex.tv.`
              : `Linked as ${user.plexUsername}.`
            : null)
        }
        variant={error ? "error" : "success"}
      />

      <PlexClient
        state={{
          plexUsername: user.plexUsername,
          shareState: user.shareState,
          isMember: user.isMember,
          streamLimit: user.streamLimit,
        }}
        libraries={
          canSeeTitles
            ? libraries.map((l) => ({ id: l.id, title: l.title, type: l.type }))
            : []
        }
        libraryCount={libraries.length}
      />
    </>
  );
}
