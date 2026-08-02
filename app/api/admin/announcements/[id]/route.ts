import { z } from "zod";
import { apiAdmin } from "@/lib/auth";
import { logError } from "@/lib/events";
import { deleteAnnouncement, updateAnnouncement } from "@/lib/announcements";
import { announcementSchema } from "../route";

/** Every field optional: the list toggles `active` on its own without resending the rest. */
const patchSchema = announcementSchema.partial().extend({
  resurface: z.coerce.boolean().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await apiAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "bad id" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Check the form." },
      { status: 400 }
    );
  }

  if (parsed.data.startsAt && parsed.data.endsAt && parsed.data.endsAt <= parsed.data.startsAt) {
    return Response.json({ error: "The end has to come after the start." }, { status: 400 });
  }

  try {
    const updated = await updateAnnouncement(id, parsed.data, {
      adminId: auth.user.id,
      adminEmail: auth.user.email,
    });

    if (!updated) return Response.json({ error: "no such announcement" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    await logError("update announcement failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: "Couldn't save that." }, { status: 502 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await apiAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "bad id" }, { status: 400 });
  }

  const removed = await deleteAnnouncement(id, {
    adminId: auth.user.id,
    adminEmail: auth.user.email,
  });

  if (!removed) return Response.json({ error: "no such announcement" }, { status: 404 });
  return Response.json({ ok: true });
}
