-- ============================================================
-- Migration 003 — additive only, backward compatible
--   * debtors.is_archived: soft delete so debt history is never destroyed
-- ============================================================

ALTER TABLE debtors
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;

-- Listing screens filter on this constantly; partial index keeps it cheap.
CREATE INDEX IF NOT EXISTS idx_debtors_active
  ON debtors (shop_id) WHERE is_archived = FALSE;
