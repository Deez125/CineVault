-- Per-user notifications the ADMIN generates by taking an action on someone's account.
--
-- Kept separate from `announcements` (which is broadcast, admin-composed, targeted by tier)
-- because the shape is different: these are always personal, always short, always tied to
-- exactly one action, and they get auto-dismissed once read rather than manually curated by
-- an admin. Reusing the announcements table would have meant a "target user" column that is
-- almost always null and a lifecycle that doesn't match.

CREATE TABLE IF NOT EXISTS "user_notifications" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Whose page it appears on. Cascade delete — a notification belongs to its user, and a
  -- deleted user has no dashboard for it to live on.
  "user_id"      uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,

  -- Discriminator so the UI can pick an icon/tone per kind and the audit log stays queryable
  -- by event class. Values are declared in code (lib/notifications.ts), NOT constrained by
  -- CHECK — a stale check constraint blocks a new notification kind from shipping.
  "kind"         text NOT NULL,

  -- Headline the user sees. Kept short: this is a one-line banner, not a message thread.
  "title"        text NOT NULL,
  -- Optional secondary line — the admin's reason ("Compensating for weekend downtime"),
  -- the amount, etc.
  "body"         text,

  -- Styling hint for the banner: "info" | "success" | "warning". Not an enum for the same
  -- reason `kind` isn't — evolving.
  "severity"     text NOT NULL DEFAULT 'info',

  -- Absolute timestamp of when it was created; the UI renders it as "3 hours ago".
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  -- Null while unread, timestamp when the user dismisses it (or when the UI auto-marks it).
  -- Read notifications aren't deleted — they stay so the admin audit view can show them.
  "read_at"      timestamptz
);

-- Unread notifications first, per user. The dashboard query is
--   WHERE user_id = $1 AND read_at IS NULL ORDER BY created_at DESC
-- which needs both columns; a partial index on (user_id, created_at) with WHERE read_at IS
-- NULL keeps it small and hot.
CREATE INDEX IF NOT EXISTS "user_notifications_unread_idx"
  ON "user_notifications" ("user_id", "created_at" DESC)
  WHERE "read_at" IS NULL;
