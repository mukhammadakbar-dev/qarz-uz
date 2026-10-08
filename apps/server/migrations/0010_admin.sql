-- 0010: superadmin paneli (ADR-0008): do'konni bloklash va egalar/xodimlarga broadcast.
--
-- Bloklangan do'kon EXPIRED kabi faqat o'qiladi (assertWritable). Broadcast jadvallariga faqat
-- nasiya_system (superadmin API va yuboruvchi) murojaat qiladi; ilova roliga hech qanday ruxsat yo'q.

ALTER TABLE businesses
  ADD COLUMN suspended_at     timestamptz,
  ADD COLUMN suspended_reason text CHECK (suspended_reason IS NULL OR char_length(suspended_reason) <= 500);

-- Ilova roli faqat egasi o'zgartiradigan ustunlarni yangilay oladi (o'zini blokdan chiqara olmaydi)
REVOKE UPDATE ON businesses FROM nasiya_app;
GRANT UPDATE (name, notify_owner_on_delete) ON businesses TO nasiya_app;

CREATE TABLE broadcasts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by    uuid NOT NULL REFERENCES users (id),
  text          text NOT NULL CHECK (char_length(btrim(text)) BETWEEN 1 AND 4000),
  -- Obuna holatlari bo'yicha filtr: TRIAL / ACTIVE / EXPIRED (bo'sh emas)
  segments      text[] NOT NULL CHECK (
    cardinality(segments) BETWEEN 1 AND 3 AND segments <@ ARRAY['TRIAL', 'ACTIVE', 'EXPIRED']
  ),
  include_staff boolean NOT NULL,
  total         integer NOT NULL CHECK (total >= 0),
  status        text NOT NULL DEFAULT 'SENDING' CHECK (status IN ('SENDING', 'DONE')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE INDEX broadcasts_created_idx ON broadcasts (created_at DESC);
CREATE INDEX broadcasts_sending_idx ON broadcasts (created_at) WHERE status = 'SENDING';

-- Har bir qabul qiluvchi alohida qator: jarayon qayta ishga tushsa ham hech kimga ikki marta yuborilmaydi
CREATE TABLE broadcast_recipients (
  broadcast_id     uuid NOT NULL REFERENCES broadcasts (id),
  user_id          uuid NOT NULL REFERENCES users (id),
  telegram_user_id bigint NOT NULL,
  status           text NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'BLOCKED')),
  error            text CHECK (error IS NULL OR char_length(error) <= 300),
  sent_at          timestamptz,
  PRIMARY KEY (broadcast_id, user_id)
);
CREATE INDEX broadcast_recipients_pending_idx ON broadcast_recipients (broadcast_id)
  WHERE status = 'PENDING';

REVOKE ALL ON broadcasts, broadcast_recipients FROM nasiya_app;
GRANT UPDATE ON broadcasts, broadcast_recipients TO nasiya_system;

-- Fail-closed: siyosat yo'q — BYPASSRLS bo'lmagan rol hech narsa ko'rmaydi
ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE broadcast_recipients ENABLE ROW LEVEL SECURITY;
