import { z } from "zod";
import { apiUser } from "@/lib/auth";
import { dismissAnnouncement } from "@/lib/announcements";

/**
 * Close a banner, for the person closing it.
 *
 * The user id comes from the session, never the body: otherwise anybody could dismiss a
 * notice on everybody else's behalf, which is a quiet way to hide an outage message from the
 * people who most need to see it.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiUser();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "bad id" }, { status: 400 });
  }

  // No existence check. Dismissing something already gone is not an error, and the foreign
  // key means a bad id simply matches nothing.
  await dismissAnnouncement(id, auth.user.id).catch(() => {});

  return Response.json({ ok: true });
}
