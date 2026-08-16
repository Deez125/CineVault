-- Analytics: MRR/churn snapshots, dormancy cache, and admin-editable operating costs.
--
-- Three separate tables because they change at different rates and for different reasons:
--
--   metrics_snapshot   is APPEND-ONLY and daily. Every row is history — never mutated once
--                      written. Deriving MRR movement (new/expansion/contraction/churned)
--                      needs yesterday to compare against today, so it must survive.
--
--   user_activity      is a CACHE of the most recent playback timestamp per user, refreshed
--                      by the worker from Plex history. Lookups per user land here rather
--                      than fanning out to Plex on every admin page render — the API call
--                      per user makes an admin page hang otherwise.
--
--   admin_costs        is CRUD state. Fixed monthly costs the admin enters so profit can be
--                      shown alongside revenue. Not derived, not fetched — just typed in.

-- ═══════════════════════════════════════════════════════════════════════════════
-- metrics_snapshot
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "metrics_snapshot" (
  -- One row per date. The nightly job upserts by this key so a repeated run overwrites
  -- itself rather than doubling up.
  "date"                    date PRIMARY KEY,

  -- ── counts ─────────────────────────────────────────────────────────────────
  -- Everything from Stripe's live view at the moment of the snapshot. `active_subscribers`
  -- excludes trialing — those go in their own column so the MRR figure stays honest
  -- (Stripe doesn't collect until the trial ends).
  "active_subscribers"      integer NOT NULL DEFAULT 0,
  "trialing_subscribers"    integer NOT NULL DEFAULT 0,
  "past_due_subscribers"    integer NOT NULL DEFAULT 0,
  "cancelling_subscribers"  integer NOT NULL DEFAULT 0,

  -- ── money, in minor units ──────────────────────────────────────────────────
  -- `mrr_cents` is the sum of active-subscription monthly normalisations. See
  -- lib/analytics/stripe-live.ts for the yearly→monthly rules. Everything is cents so
  -- there is exactly one place (the formatter) where a decimal enters the picture.
  "mrr_cents"               integer NOT NULL DEFAULT 0,
  "at_risk_mrr_cents"       integer NOT NULL DEFAULT 0,
  "cancelling_mrr_cents"    integer NOT NULL DEFAULT 0,
  "arpu_cents"              integer NOT NULL DEFAULT 0,

  -- ── per-tier breakdown ─────────────────────────────────────────────────────
  -- {"1": {"count": 4, "mrr_cents": 8000}, ...}. Keyed by streamLimit so the frontend
  -- can label tiers without a second lookup. jsonb (not json) so postgres can index it
  -- later if we ever need to.
  "by_tier"                 jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- ── movement vs yesterday ──────────────────────────────────────────────────
  -- Diff between today's per-subscription MRR and yesterday's snapshot. When yesterday
  -- doesn't exist (first day, or a missed run), these are all 0 — a "day one" that
  -- claims $0 of new MRR is a less misleading answer than a wild number.
  "new_subscribers"         integer NOT NULL DEFAULT 0,
  "churned_subscribers"     integer NOT NULL DEFAULT 0,
  "churned_voluntary"       integer NOT NULL DEFAULT 0,
  "churned_involuntary"     integer NOT NULL DEFAULT 0,
  "new_mrr_cents"           integer NOT NULL DEFAULT 0,
  "expansion_mrr_cents"     integer NOT NULL DEFAULT 0,
  "contraction_mrr_cents"   integer NOT NULL DEFAULT 0,
  "churned_mrr_cents"       integer NOT NULL DEFAULT 0,

  -- ── dormancy ───────────────────────────────────────────────────────────────
  -- Populated from user_activity at snapshot time. Kept alongside the money figures so
  -- a single row is one complete picture of the business on that date.
  "dormant_30d"             integer NOT NULL DEFAULT 0,
  "dormant_60d"             integer NOT NULL DEFAULT 0,

  "created_at"              timestamptz NOT NULL DEFAULT now()
);

-- Descending index so the "latest snapshot" and "last N days" reads on the analytics page
-- don't scan the whole table. `date` is already unique so the index is cheap.
CREATE INDEX IF NOT EXISTS "metrics_snapshot_date_desc_idx"
  ON "metrics_snapshot" ("date" DESC);


-- ═══════════════════════════════════════════════════════════════════════════════
-- user_activity
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "user_activity" (
  -- One row per CineVault user. Not per Plex user — a Plex account that isn't linked to a
  -- CineVault account is not our audience for the dormant report.
  "user_id"             uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,

  -- Most recent viewedAt from Plex history for this user's linked Plex account. Null when
  -- Plex has no history at all — "never watched" — so the panel can bucket those separately
  -- from "watched 90 days ago".
  "last_watched_at"     timestamptz,

  -- Reserved for the top-transcoders panel we deliberately left off the first cut. Populated
  -- by the same nightly pass so switching it on later doesn't require a schema change.
  "transcode_count_30d" integer NOT NULL DEFAULT 0,

  -- When THIS ROW was last refreshed. The freshness check the admin sees ("last refreshed
  -- 3h ago") reads this, not last_watched_at.
  "updated_at"          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "user_activity_last_watched_at_idx"
  ON "user_activity" ("last_watched_at");


-- ═══════════════════════════════════════════════════════════════════════════════
-- admin_costs
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "admin_costs" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Free-text label the admin sees in the list. "Hetzner server", "Plex Pass", "Cloudflare".
  "name"          text NOT NULL,

  -- The recurring monthly cost in cents. Yearly things get divided into monthly by the
  -- admin before typing — same convention as MRR uses on the revenue side, so profit is a
  -- straight subtraction with no unit conversion.
  "monthly_cents" integer NOT NULL,

  -- Rather than hard-deleting a cost, admins can toggle it off. Preserves the history of
  -- what was expensed in a given month for later reconstruction, without cluttering the
  -- active total.
  "active"        boolean NOT NULL DEFAULT true,

  -- Optional detail line beneath the name. "Renews 15th", "shared with other project", etc.
  "notes"         text,

  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "admin_costs_active_idx" ON "admin_costs" ("active");
