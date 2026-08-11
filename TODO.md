# TODO

Open items after the Supabase Auth migration. Roughly ordered by "closest to the deploy".

## Auth

- [ ] **Test the ban flow end-to-end.** The code is written and looks right, but nobody has run it. Sign in as an admin, ban yourself from `/admin/users`, confirm: (a) the current session dies on the next request, (b) trying to log in again shows "This account has been banned", (c) unbanning restores login. Ban writes both to `users.banned` and to Supabase Auth's native `ban_duration`, so both sides need to be checked.
- [ ] **Wire up Google OAuth.** The button is already on `/login` and `/signup`, and the code path through `/auth/callback` already handles OAuth completions. Two dashboard steps remain:
  - In Google Cloud Console, create an OAuth 2.0 Web client. Set **Authorized redirect URI** to `https://fyivhkvfjapmekvfcqkw.supabase.co/auth/v1/callback`.
  - In Supabase → Authentication → Providers → Google, toggle on and paste the client ID + secret.
- [ ] **Fill in the Change Email and Magic Link templates.** Same shell as the two we already did. Change Email uses `{{ .NewEmail }}` for the target address; Magic Link uses `{{ .ConfirmationURL }}` (or the same `{{ .TokenHash }}` custom URL pattern). Only worth doing when we wire up flows that actually send them — no code path triggers either today.

## Production cutover

- [ ] **Create a separate Supabase project for prod.** Dev and prod deliberately do not share a database — a schema mistake or a test wipe on dev must not touch real customers. Same shape as the dev project: Session Pooler URL in `DATABASE_URL`, custom SMTP wired to Resend, redirect URLs pointing at `https://getcinevault.com/auth/confirm` and `/auth/callback` and `/reset`.
- [ ] **Dump the current Coolify Postgres and restore into the new prod Supabase project.** Members exist there and would re-link Plex from scratch if we lost them. `pg_dump` from the Coolify container, `pg_restore` into Supabase, then `npm run db:migrate` against the new URL to apply migration 0010 on top.
- [ ] **Swap Coolify's env vars.** New `DATABASE_URL`, plus the three `SUPABASE_*` values from the prod project. Once redeployed, existing accounts will need to reset their passwords once (Supabase has no idea what their old scrypt hashes were), or we build a one-shot migration that imports the old hashes as `crypt('$1', gen_salt('bf'))`-equivalent — Supabase's docs describe the flow.
- [ ] **Stripe live cutover.** Swap `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` in Coolify from `sk_test_`/`pk_test_` to `sk_live_`/`pk_live_`. Then run `npm run stripe:setup` against live mode so the tiers get their `metadata.streams` written. Live keys are in `REF/coolify.env.LIVE.txt`. Guarded any destructive scripts against `sk_live_` first.
- [ ] **Point the Stripe webhook at prod.** New endpoint in Stripe live dashboard, same 8 events as sandbox, forwarding to `https://getcinevault.com/api/webhooks/stripe`. Copy the resulting `whsec_...` into Coolify as `STRIPE_WEBHOOK_SECRET`.

## Housekeeping

- [ ] **Commit the Supabase-Auth work.** A lot has changed since the `pre-supabase-auth` tag (`383b76f`): schema migration 0010, new `lib/supabase/`, rewritten `lib/auth/`, rewritten admin ban, new `/auth/callback` and `/auth/confirm`, updated auth pages, `proxy.ts` for session refresh, deleted `lib/auth/password.ts`, trimmed `lib/maintenance.ts` and `worker/index.ts`. One commit with a real message covering all of it.
- [ ] **Turn on `ENFORCE_STREAM_LIMITS` once dry-run logs look right.** The enforcer is running in dry-run in production per handoff §7; the logs say what it *would* have killed. Watch those against real traffic for a couple of days, then flip the flag.
- [ ] **Database backups on the new Supabase project.** Free tier does daily; Pro adds point-in-time. Decide which fits the budget when we're ready.
- [ ] **Refund leftover account credit on cancel.** Right now it sits in the account forever — noted in handoff §10.
- [ ] **Legal read of `/terms` and `/privacy`.** Still a plain-English draft with placeholders.

## Nice-to-have

- [ ] **Custom Supabase Auth domain** (e.g. `auth.getcinevault.com`) so users never see `supabase.co` in verify URLs at all. Requires Pro plan.
- [ ] **Drop the `SESSION_SECRET` env var if nothing still uses it.** Was for CSRF on the old auth; the whole `lib/auth/session.ts` that used it is gone.
