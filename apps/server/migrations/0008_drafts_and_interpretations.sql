-- 0008: qoralamalar (pending_operations) va interpretatsiya jurnali (ADR-0003, ADR-0004 §13).
--
-- Moliyaviy yozuv matndan to'g'ridan-to'g'ri tug'ilmaydi: avval qoralama, foydalanuvchi tasdiqlagach
-- LedgerService (idempotency_key = qoralama ID si) orqali yoziladi.

CREATE TABLE pending_operations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid NOT NULL REFERENCES businesses (id),
  user_id           uuid NOT NULL REFERENCES users (id),
  -- DraftSpec: { type, customerId, newCustomerName, amount, dateOffsetDays, expectedBalance, kind }
  payload           jsonb NOT NULL,
  status            text NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING', 'COMMITTED', 'CANCELLED', 'EXPIRED', 'SUPERSEDED')),
  interpretation_id uuid,
  result_entry_id   uuid,
  expires_at        timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pending_committed_has_entry CHECK (status <> 'COMMITTED' OR result_entry_id IS NOT NULL)
);
CREATE INDEX pending_operations_user_idx ON pending_operations (business_id, user_id, status);
CREATE INDEX pending_operations_expiry_idx ON pending_operations (expires_at) WHERE status = 'PENDING';
GRANT UPDATE ON pending_operations TO nasiya_app, nasiya_system;
CREATE TRIGGER pending_operations_set_updated_at BEFORE UPDATE ON pending_operations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE pending_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY pending_operations_select ON pending_operations FOR SELECT USING (business_id = app_business_id());
CREATE POLICY pending_operations_insert ON pending_operations FOR INSERT WITH CHECK (business_id = app_business_id());
CREATE POLICY pending_operations_update ON pending_operations FOR UPDATE
  USING (business_id = app_business_id()) WITH CHECK (business_id = app_business_id());

-- Interpretatsiya jurnali: sifatni o'lchash va xatolarni tahlil qilish uchun. Foydalanuvchi matni FAQAT
-- redaksiya qilingan (telefon/karta chiqarilgan) ko'rinishda; 30 kundan keyin tozalanadi (ADR-0004 §13).
CREATE TABLE ai_interpretations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL REFERENCES businesses (id),
  user_id        uuid NOT NULL REFERENCES users (id),
  input_redacted text NOT NULL CHECK (char_length(input_redacted) <= 1000),
  rule_output    jsonb,
  llm_output     jsonb,
  final_intent   jsonb,
  provider       text NOT NULL,
  model          text,
  prompt_version text,
  latency_ms     integer,
  outcome        text CHECK (outcome IS NULL OR outcome IN
                   ('CONFIRMED', 'EDITED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'CLARIFIED', 'UNKNOWN')),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_interpretations_business_idx ON ai_interpretations (business_id, created_at DESC);
CREATE INDEX ai_interpretations_created_idx ON ai_interpretations (created_at);
GRANT UPDATE (outcome) ON ai_interpretations TO nasiya_app, nasiya_system;
GRANT DELETE ON ai_interpretations TO nasiya_system;

ALTER TABLE ai_interpretations ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_interpretations_select ON ai_interpretations FOR SELECT USING (business_id = app_business_id());
CREATE POLICY ai_interpretations_insert ON ai_interpretations FOR INSERT WITH CHECK (business_id = app_business_id());
CREATE POLICY ai_interpretations_update ON ai_interpretations FOR UPDATE
  USING (business_id = app_business_id()) WITH CHECK (business_id = app_business_id());
