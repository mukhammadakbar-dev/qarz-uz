-- 0003: obuna (ADR-0005). Holat (TRIAL/ACTIVE/EXPIRED) saqlanmaydi, sanalardan hisoblanadi.
--
-- subscriptions: ilova roli yaratadi va o'qiydi; uzaytirish (UPDATE) faqat nasiya_system (superadmin buyruqlari).
-- subscription_payments: append-only, faqat nasiya_system yozadi.

CREATE TABLE subscriptions (
  business_id   uuid PRIMARY KEY REFERENCES businesses (id) ON DELETE CASCADE,
  trial_ends_at timestamptz NOT NULL,
  paid_until    timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_trial_idx ON subscriptions (trial_ends_at);
CREATE INDEX subscriptions_paid_idx ON subscriptions (paid_until) WHERE paid_until IS NOT NULL;
GRANT UPDATE ON subscriptions TO nasiya_system;
CREATE TRIGGER subscriptions_set_updated_at BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY subscriptions_select ON subscriptions FOR SELECT USING (business_id = app_business_id());
CREATE POLICY subscriptions_insert ON subscriptions FOR INSERT WITH CHECK (business_id = app_business_id());

CREATE TABLE subscription_payments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id),
  amount      bigint NOT NULL CHECK (amount > 0),
  months      integer NOT NULL CHECK (months BETWEEN 1 AND 36),
  period_from timestamptz NOT NULL,
  period_to   timestamptz NOT NULL CHECK (period_to > period_from),
  recorded_by uuid NOT NULL REFERENCES users (id),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscription_payments_business_idx ON subscription_payments (business_id, created_at DESC);
REVOKE INSERT ON subscription_payments FROM nasiya_app;
CREATE TRIGGER subscription_payments_immutable BEFORE UPDATE OR DELETE ON subscription_payments
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();

ALTER TABLE subscription_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY subscription_payments_select ON subscription_payments FOR SELECT
  USING (business_id = app_business_id());
