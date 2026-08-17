-- Admin invite links: same table, one column distinguishes.
--
-- Admin-issued invites need to satisfy the invite-only signup gate but MUST NOT trigger the
-- referee discount or the referrer credit machinery. Splitting into a separate table was
-- considered and rejected: every read on referral_links (findLink, inspectCode, sweep,
-- purge, revoke) would then need a parallel version. One column with a default keeps every
-- existing query correct — a row with kind='referral' behaves exactly as before — and lets
-- the signup path branch on the single field it needs to check.

ALTER TABLE "referral_links"
  ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'referral';

-- Index so the admin invites page can list its own kind without scanning the whole table.
-- Partial on kind so it stays small — the overwhelming majority of rows are 'referral' and
-- don't need to appear here.
CREATE INDEX IF NOT EXISTS "referral_links_admin_kind_idx"
  ON "referral_links" ("owner_id", "created_at" DESC)
  WHERE "kind" = 'admin_invite';
