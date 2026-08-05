-- ============================================================
-- Migration 005 — server-side storage for Telegram bot sessions
--
-- The bot previously kept every user's session in a local .sessions.json:
-- live access AND refresh tokens, in plaintext, on the bot container's disk.
-- That file is lost whenever the container is recreated (logging every user
-- out) and cannot be shared by more than one bot process.
--
-- Moving it here makes sessions survive redeploys and keeps the credentials
-- inside the database that already holds everything else.
-- ============================================================

CREATE TABLE IF NOT EXISTS bot_sessions (
  -- Telegram user id. BIGINT, not INT: Telegram ids already exceed 2^31.
  telegram_id  BIGINT PRIMARY KEY,

  -- Opaque to the backend: { accessToken, refreshToken, role, phone, lang, ... }.
  -- The bot owns this shape, so it can evolve without a migration here.
  data         JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The bot hydrates its cache at startup with a single ordered read, and a
-- sweep deletes long-abandoned sessions; both are index scans on this column.
CREATE INDEX IF NOT EXISTS idx_bot_sessions_updated_at
  ON bot_sessions (updated_at);
