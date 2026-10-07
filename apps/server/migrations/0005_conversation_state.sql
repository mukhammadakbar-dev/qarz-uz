-- 0005: suhbat holati (ADR-0004 §12). Private chatda foydalanuvchi bo'yicha bitta faol holat.
-- Onboarding (biznes nomini kutish) uchun biznes hali yo'q, shuning uchun RLS user_id bo'yicha.
-- Keyingi bosqichlarda (draft, summa kutish) `data` ga biznes konteksti yoziladi.

CREATE TABLE conversation_state (
  user_id    uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  state      text NOT NULL CHECK (char_length(state) BETWEEN 1 AND 64),
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversation_state_expires_idx ON conversation_state (expires_at);
GRANT UPDATE, DELETE ON conversation_state TO nasiya_app, nasiya_system;

ALTER TABLE conversation_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY conversation_state_owner ON conversation_state
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
