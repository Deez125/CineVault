import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { AnnouncementsClient } from "./announcements-client";
import { listAll } from "@/lib/announcements";

export const metadata: Metadata = { title: "Announcements" };

export default async function AdminAnnouncementsPage() {
  const items = await listAll();

  return (
    <>
      <PageHeader
        title="Announcements"
        subtitle="Banners on everyone's dashboard"
        badge={items.filter((i) => i.active).length}
      />

      {/* Dates are serialised for the client boundary. Passing Date objects through would
          work in dev and then differ subtly once serialised in production. */}
      <AnnouncementsClient
        items={items.map((item) => ({
          id: item.id,
          title: item.title,
          body: item.body,
          severity: item.severity,
          active: item.active,
          startsAt: item.startsAt?.toISOString() ?? null,
          endsAt: item.endsAt?.toISOString() ?? null,
          createdAt: item.createdAt.toISOString(),
          dismissals: item.dismissals,
        }))}
      />
    </>
  );
}
