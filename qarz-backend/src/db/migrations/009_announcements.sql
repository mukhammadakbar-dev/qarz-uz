-- ============================================================
-- Migration 009 — platform announcements shop owners can actually read
--
-- The broadcast reached owners over Telegram, or by SMS when no Telegram was
-- linked, and was then gone: nothing was stored, so an owner who missed the
-- message had no way to find it, and the web app had nothing to show. In
-- practice it was worse than that — no shop owner had a telegram_id at all, so
-- every announcement went out as paid SMS through a provider that is not yet
-- configured.
--
-- Storing the announcement makes the web the reliable channel (free, permanent,
-- and there whenever the owner next signs in); Telegram stays as the push on top.
--
-- Two tables rather than one row per owner: an announcement is one thing that
-- was said once, and who has read it is a separate, growing fact about it.
-- Copying the body per recipient would duplicate the text N times and make
-- editing or deleting an announcement a fan-out.
-- ============================================================

CREATE TABLE IF NOT EXISTS announcements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  body        TEXT NOT NULL,
  -- Which admin sent it. ON DELETE SET NULL: removing an admin account must not
  -- erase the announcements the platform made.
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Newest first is the only order this is ever read in.
CREATE INDEX IF NOT EXISTS idx_announcements_created
  ON announcements (created_at DESC);

CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The composite key is the dedupe: marking something read twice (two tabs,
  -- a double tap) is an upsert, never a second row.
  PRIMARY KEY (announcement_id, user_id)
);

-- "What has this user not read yet?" runs on every page load.
CREATE INDEX IF NOT EXISTS idx_announcement_reads_user
  ON announcement_reads (user_id);
