-- 0004: audit_logs (append-only) va Telegram update dedupe (ADR-0003, ADR-0006 §8).

CREATE TABLE audit_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid REFERENCES businesses (id),
  actor_user_id uuid REFERENCES users (id),
  action        text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 100),
  entity        text NOT NULL,
  entity_id     text,
  before        jsonb,
  after         jsonb,
  request_id    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_business_idx ON audit_logs (business_id, created_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity, entity_id);

CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_modification();

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_logs_select ON audit_logs FOR SELECT USING (business_id = app_business_id());
CREATE POLICY audit_logs_insert ON audit_logs FOR INSERT WITH CHECK (business_id = app_business_id());

-- Webhook dublikatlarini filtrlash (best-effort; moliyaviy kafolat emas, ADR-0003).
CREATE TABLE processed_updates (
  update_id   bigint PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX processed_updates_received_idx ON processed_updates (received_at);
GRANT DELETE ON processed_updates TO nasiya_system;
