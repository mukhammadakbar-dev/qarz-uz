-- ============================================================
-- Migration 002
--  * otp_codes: two-step Telegram linking (fixes account takeover)
--  * reminder_settings.repeat_interval_days: spacing between reminders
-- Backward compatible: only additive.
-- ============================================================

-- ---------- OTP codes ----------
CREATE TABLE IF NOT EXISTS otp_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       VARCHAR(20) NOT NULL,
  code_hash   TEXT NOT NULL,          -- HMAC-SHA256, never plaintext
  purpose     VARCHAR(40) NOT NULL DEFAULT 'telegram_link',
  attempts    INTEGER NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_otp_phone_purpose
  ON otp_codes (phone, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_otp_expires ON otp_codes (expires_at);

-- ---------- Reminder spacing ----------
ALTER TABLE reminder_settings
  ADD COLUMN IF NOT EXISTS repeat_interval_days INTEGER NOT NULL DEFAULT 3;
