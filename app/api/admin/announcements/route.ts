import { z } from "zod";
import { apiAdmin } from "@/lib/auth";
import { logError } from "@/lib/events";
import { createAnnouncement } from "@/lib/announcements";
import { SEVERITIES } from "@/lib/announcement-types";

/**
 * A date that may be absent.
 *
 * An empty string is what an untouched `<input type="datetime-local">` submits, and it means
 * "no bound" — not "the epoch", which is what `new Date("")` would quietly hand back.
 */
const optionalDate = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  });

export const announcementSchema = z.object({
  title: z.string().trim().min(1, "Give it a title.").max(120),
  body: z.string().trim().max(2000).optional().transform((v) => v || null),
  severity: z.enum(SEVERITIES).default("info"),
  active: z.coerce.boolean().default(true),
  startsAt: optionalDate,
  endsAt: optionalDate,
});

export async function POST(request: Request) {
  const auth = await apiAdmin();
  if (!auth.ok) return auth.response;

  const parsed = announcementSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Check the form." },
      { status: 400 }
    );
  }

  // A window that has already closed would be posted and immediately invisible, which reads
  // as the feature being broken.
  if (parsed.data.startsAt && parsed.data.endsAt && parsed.data.endsAt <= parsed.data.startsAt) {
    return Response.json({ error: "The end has to come after the start." }, { status: 400 });
  }

  try {
    const created = await createAnnouncement(parsed.data, {
      adminId: auth.user.id,
      adminEmail: auth.user.email,
    });
    return Response.json({ ok: true, id: created.id });
  } catch (err) {
    await logError("create announcement failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: "Couldn't post that." }, { status: 502 });
  }
}
