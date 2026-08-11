-- Cut identity over to Supabase Auth.
--
-- Before this migration a user's password, session and reset tokens all lived in this schema.
-- After it they live in Supabase's `auth` schema: our `users` table is a PROFILE that hangs off
-- an `auth.users` row by shared UUID. Everything downstream (subscription state, Plex identity,
-- referrals, entitlements) is unchanged — it never cared how the user authenticated.
--
-- The trigger below is what keeps them in step: every new `auth.users` row (from any provider
-- — password, Google, whatever) fires an insert into our `users`. The FK from `users.id` to
-- `auth.users(id)` means the row cannot exist unless Supabase says the identity exists, and it
-- cascades on delete so removing an account through Supabase's admin API cleans us up too.

-- ── 1. Drop tables Supabase Auth now owns ──────────────────────────────────
-- IF EXISTS on each because this migration should be idempotent-adjacent — a dev who ran an
-- earlier partial attempt should still be able to apply it.
DROP TABLE IF EXISTS "sessions";
--> statement-breakpoint
DROP TABLE IF EXISTS "pending_signups";
--> statement-breakpoint
DROP TABLE IF EXISTS "email_tokens";
--> statement-breakpoint

-- ── 2. `users.password_hash` is no longer used ─────────────────────────────
ALTER TABLE "users" DROP COLUMN IF EXISTS "password_hash";
--> statement-breakpoint

-- ── 3. Link users.id to auth.users(id) ─────────────────────────────────────
-- The FK does the enforcement the trigger cannot: no orphan profile row can be inserted, and a
-- delete in Supabase Auth cascades here. Drop first for idempotency.
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_id_auth_fkey";
--> statement-breakpoint
ALTER TABLE "users"
  ADD CONSTRAINT "users_id_auth_fkey"
  FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- ── 4. Trigger: create a profile row when an auth user is created ──────────
-- SECURITY DEFINER lets this run as the owner (postgres) rather than the caller. Supabase Auth
-- inserts as its own restricted role, which does not have write access to our public schema.
--
-- SET search_path = '' is the standard hardening: without it, a rogue schema on the caller's
-- search_path could shadow `public.users` and steer the insert. We fully qualify every table.
--
-- ON CONFLICT DO NOTHING makes the trigger idempotent — if a profile row somehow already
-- exists (a partial retry, an admin script), the auth insert doesn't blow up.
CREATE OR REPLACE FUNCTION "public"."handle_new_auth_user"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO "public"."users" (
    "id",
    "email",
    "email_verified_at",
    "referred_by"
  )
  VALUES (
    NEW.id,
    LOWER(NEW.email),
    NEW.email_confirmed_at,
    -- The signup flow drops the referring user id into user_metadata under `referred_by`.
    -- Cast to uuid deliberately: a bad value should fail loudly at insert rather than land as
    -- a text mismatch we notice weeks later when nobody gets paid for a referral.
    NULLIF(NEW.raw_user_meta_data->>'referred_by', '')::uuid
  )
  ON CONFLICT ("id") DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "on_auth_user_created" ON "auth"."users";
--> statement-breakpoint
CREATE TRIGGER "on_auth_user_created"
  AFTER INSERT ON "auth"."users"
  FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_auth_user"();
--> statement-breakpoint

-- ── 5. Trigger: keep `email` and `email_verified_at` in sync ───────────────
-- Supabase writes `email_confirmed_at` when a user clicks the verification link, and it can
-- change the email address itself (via change-email flow). We want our copy to follow both
-- without a background reconciler having to notice.
--
-- Only bothers the row if something we care about changed — otherwise every `auth.users`
-- update (last_sign_in_at flips on every login) would rewrite our row for no reason.
CREATE OR REPLACE FUNCTION "public"."handle_auth_user_updated"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email
     OR NEW.email_confirmed_at IS DISTINCT FROM OLD.email_confirmed_at THEN
    UPDATE "public"."users"
    SET
      "email" = LOWER(NEW.email),
      "email_verified_at" = NEW.email_confirmed_at,
      "updated_at" = NOW()
    WHERE "id" = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "on_auth_user_updated" ON "auth"."users";
--> statement-breakpoint
CREATE TRIGGER "on_auth_user_updated"
  AFTER UPDATE ON "auth"."users"
  FOR EACH ROW EXECUTE FUNCTION "public"."handle_auth_user_updated"();
