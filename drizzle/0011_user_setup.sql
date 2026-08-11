-- A one-time setup step every new account has to complete before it can use the app.
--
-- The signup flow (Supabase auth) captures nothing beyond email + password. Everything else
-- — the display name and profile picture that everybody else on the platform sees, the
-- username that references and mentions run through — is gathered on a dedicated /setup
-- screen, which the proxy sends visitors to whenever `setup_complete` is false.
--
-- Kept as a boolean, not a null-if-incomplete timestamp, because the question is only
-- "should we ask them the setup questions again?" — a `false` covers OAuth signups that
-- came in with a Google display name but never chose a username, just as well as it covers
-- fresh password signups.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "setup_complete" boolean NOT NULL DEFAULT false;
