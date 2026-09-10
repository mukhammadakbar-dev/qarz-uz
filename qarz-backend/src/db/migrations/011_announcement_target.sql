-- ============================================================
-- Migration 011 — Target audience categories for announcements
--
-- Lets SuperAdmin broadcast announcements to specific segments:
-- 'all', 'active', 'trial', 'expired', 'blocked', 'plan_start', 'plan_pro', 'plan_business'
-- ============================================================

ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS target_type VARCHAR(32) NOT NULL DEFAULT 'all';

CREATE INDEX IF NOT EXISTS idx_announcements_target
  ON announcements (target_type);
