# CineVault

Paid access to a privately run Plex media server. Members pick a plan, pay through Stripe,
link their Plex account, and get shared into the libraries. Plans are sold by **concurrent
streams** (1–4).

Single self-contained Next.js app. **There is no Discord**, despite the folder name and some
leftover marketing copy — the previous build was a Discord bot and this replaces it.

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind v4 · Drizzle/Postgres ·
Stripe · Resend · the Plex API directly.

> **Full context — history, architecture, what's done, what's left, and the mistakes already
> made — is in [CLAUDE-HANDOFF.md](CLAUDE-HANDOFF.md). Read it before any substantial work.**

## Running it

```bash
docker compose up -d postgres     # Postgres 17 on host port 5433, NOT 5432
npm run db:migrate
npm run dev                       # http://localhost:3100
npm run worker                    # second terminal — background loops
```

Secrets live in `.env.local`, which is gitignored. The app validates its environment at import
and refuses to start when anything required is missing.

## Rails — do not break these

**`REF/` is read-only.** Reference material from the previous build. Read it; never write to
it. It is deleted when the rebuild is done.

**Stripe stays in sandbox.** Going live is a deliberate, separate decision. Do not swap keys,
and do not run setup scripts against live mode, without being asked to.

**`PLEX_PROTECTED_USERS`** — 17 Plex accounts that predate this system. Never revoke their
share, never kill their streams, no exceptions. Every destructive Plex operation checks
`isProtected()` in `lib/plex/protected.ts`. Keep that the only chokepoint.

**`applyEntitlement()` in `lib/entitlements.ts` is the one door** — the only function that may
change a member's access. Do not add a second path that grants or revokes.

**Never trust a webhook's payload snapshot.** Stripe does not guarantee ordering; always
re-read the subscription from Stripe. An out-of-order event once revoked paying members.

**Confirm before anything outward-facing** — pushing, deploying, touching Stripe or Plex state.

## Conventions

**Comments explain *why*, never *what*** — what breaks otherwise, what was tried, what the
failure mode is. A comment restating the code is noise. See `lib/enforce.ts` for the register.

**Guard the data, not just the page.** A check in a page component is theatre; the route
handlers behind it still answer. Every route handler and server action calls
`requireUser`/`requireMember`/`requireAdmin` — or the `api*` equivalents, which return a
`Response` instead of redirecting — for itself.

**Non-members get 404, not a teaser.** Someone without a plan should not learn that
`/dashboard/plex` exists.

**Auth responses never reveal whether an address is registered.** Signup, forgot-password and
resend all answer identically whatever the truth is.

**`"use server"` files may only export async functions.** A constant breaks the build.

**Run it, don't reason about it.** Two real bugs were found only by executing the real path
after the code looked fine on inspection. Verify your test harness before blaming the code.

Commits: `Area: lowercase description`, body explains why, ending with
`Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
