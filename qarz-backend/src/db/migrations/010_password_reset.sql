-- ============================================================
-- Migration 010
--  * password_reset_requests: marks that someone asked to reset the password
--    for a phone, so the bot only hands out a reset code when it was actually
--    requested from the website.
--
-- The code itself lives in otp_codes under purpose 'password_reset' — that
-- column is free-form VARCHAR, so no change is needed there.
-- ============================================================

CREATE TABLE IF NOT EXISTS password_reset_requests (
  -- One outstanding request per phone: a second "I forgot my password" simply
  -- refreshes the window rather than piling up rows.
  phone        VARCHAR(20) PRIMARY KEY,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Short-lived on purpose: this is only the window in which the bot will read
  -- a code out, not the life of the code (otp_codes owns that, 5 minutes).
  expires_at   TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_password_reset_expires
  ON password_reset_requests (expires_at);
