-- 0009: Mini App so'rovlari uchun idempotentlik (ADR-0003 §3).
-- Bir xil (user_id, kalit) bilan takroriy POST so'rovga saqlangan javob qaytariladi; boshqa tana bilan bo'lsa 422.
-- Foydalanuvchi bo'yicha RLS: javoblarda moliyaviy ma'lumot bor.

CREATE TABLE idempotency_keys (
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  key          text NOT NULL CHECK (char_length(key) BETWEEN 8 AND 128),
  request_hash text NOT NULL,
  state        text NOT NULL DEFAULT 'IN_PROGRESS' CHECK (state IN ('IN_PROGRESS', 'DONE')),
  status_code  integer,
  response     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
CREATE INDEX idempotency_keys_created_idx ON idempotency_keys (created_at);
GRANT UPDATE, DELETE ON idempotency_keys TO nasiya_app, nasiya_system;

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY idempotency_keys_owner ON idempotency_keys
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
