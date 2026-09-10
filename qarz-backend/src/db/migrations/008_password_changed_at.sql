-- ============================================================
-- Migration 008 — make a password change actually end other sessions
--
-- Refresh tokens are 30-day JWTs and there is no revocation list, so changing a
-- password did nothing to sessions already issued. Someone who changes their
-- password BECAUSE their account was compromised left the attacker's refresh
-- token — and the attacker's bot session — working for up to another month.
--
-- Recording when the password last changed gives /auth/refresh something to
-- compare a token's `iat` against, which is enough to cut off every token
-- minted before the change without storing a blocklist.
--
-- NULL means "never changed since this column existed": those accounts keep
-- working, which is the right default for a column added under running traffic.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
