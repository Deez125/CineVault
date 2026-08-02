import { z } from "zod";
import { apiUser } from "@/lib/auth";
import { restoreAnnouncement } from "@/lib/announcements";

/**
 * Undo a dismissal, for the person undoing it.
 *
 * The user id comes from the session, never the body — otherwise anybody could un-dismiss a
 * notice on somebody else's dashboard, which is a small but real way to nag people.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiUser();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "bad id" }, { status: 400 });
  }

  await restoreAnnouncement(id, auth.user.id).catch(() => {});
  return Response.json({ ok: true });
}
