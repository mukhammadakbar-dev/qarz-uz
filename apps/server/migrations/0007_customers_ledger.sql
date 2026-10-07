-- 0007: mijozlar, ledger va balans proyeksiyasi (ADR-0002).
--
-- Xavfsizlik g'oyasi: invariantlar DB'ning o'zida majburlanadi, shuning uchun ilovadagi xato ham
-- pulni buza olmaydi:
--   * ledger_entries o'zgarmas (UPDATE/DELETE/TRUNCATE taqiqlangan, app roliga grant ham yo'q)
--   * customer_balances.balance >= 0 (CHECK) — ortiqcha to'lov DB darajasida ham yozilmaydi
--   * balans FAQAT ledger INSERT trigger'i orqali o'zgaradi; app roli unga yoza olmaydi
--   * storno: faqat original yozuvga, bir marta, teskari summa bilan, stornoni stornolab bo'lmaydi

-- ───────── customers ─────────
CREATE TABLE customers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      uuid NOT NULL REFERENCES businesses (id),
  name             text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  normalized_name  text NOT NULL CHECK (char_length(normalized_name) BETWEEN 1 AND 100),
  label            text CHECK (label IS NULL OR char_length(btrim(label)) BETWEEN 1 AND 50),
  normalized_label text CHECK ((label IS NULL) = (normalized_label IS NULL)),
  phone            text CHECK (phone IS NULL OR phone ~ '^\+998[0-9]{9}$'),
  notes            text CHECK (notes IS NULL OR char_length(notes) <= 500),
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_by       uuid NOT NULL REFERENCES users (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, id)
);
-- Bir xil (ism, yorliq) juftligi faol mijozlar orasida takrorlanmaydi; bir xil ism uchun yorliq farqlaydi (TT §12)
CREATE UNIQUE INDEX customers_identity_uq
  ON customers (business_id, normalized_name, COALESCE(normalized_label, ''))
  WHERE status = 'ACTIVE';
CREATE INDEX customers_name_trgm_idx ON customers USING gin (normalized_name gin_trgm_ops);
CREATE INDEX customers_business_idx ON customers (business_id, status, normalized_name);
CREATE INDEX customers_created_idx ON customers (business_id, created_at DESC, id);
GRANT UPDATE ON customers TO nasiya_app, nasiya_system;
CREATE TRIGGER customers_set_updated_at BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY customers_select ON customers FOR SELECT USING (business_id = app_business_id());
CREATE POLICY customers_insert ON customers FOR INSERT WITH CHECK (business_id = app_business_id());
CREATE POLICY customers_update ON customers FOR UPDATE
  USING (business_id = app_business_id()) WITH CHECK (business_id = app_business_id());

-- ───────── customer_balances (proyeksiya; haqiqat manbai — ledger) ─────────
CREATE TABLE customer_balances (
  customer_id   uuid PRIMARY KEY,
  business_id   uuid NOT NULL,
  balance       bigint NOT NULL DEFAULT 0
                CONSTRAINT customer_balances_balance_check CHECK (balance >= 0),
  last_entry_id uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, customer_id) REFERENCES customers (business_id, id)
);
CREATE INDEX customer_balances_business_idx ON customer_balances (business_id, balance DESC);
-- Hech bir ilova roli balansga to'g'ridan-to'g'ri yoza olmaydi: faqat quyidagi trigger'lar (SECURITY DEFINER)
REVOKE INSERT ON customer_balances FROM nasiya_app, nasiya_system;

ALTER TABLE customer_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY customer_balances_select ON customer_balances FOR SELECT
  USING (business_id = app_business_id());

-- Yangi mijoz uchun 0 balans qatori avtomatik yaratiladi
CREATE FUNCTION customers_init_balance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO customer_balances (customer_id, business_id) VALUES (NEW.id, NEW.business_id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER customers_init_balance AFTER INSERT ON customers
  FOR EACH ROW EXECUTE FUNCTION customers_init_balance();

-- ───────── ledger_entries ─────────
CREATE TABLE ledger_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Qo'shilish tartibi (ketma-ket): tarix va "qoldiq" shu bo'yicha hisoblanadi (ADR-0002 §8)
  seq               bigint GENERATED ALWAYS AS IDENTITY,
  business_id       uuid NOT NULL,
  customer_id       uuid NOT NULL,
  type              text NOT NULL CHECK (type IN ('DEBT', 'PAYMENT', 'ADJUSTMENT')),
  amount            bigint NOT NULL,
  -- balans = SUM(delta). DEBT: +amount, PAYMENT: -amount, ADJUSTMENT: ishorali amount
  delta             bigint GENERATED ALWAYS AS (
                      CASE type WHEN 'PAYMENT' THEN -amount ELSE amount END
                    ) STORED,
  currency          text NOT NULL DEFAULT 'UZS' CHECK (currency ~ '^[A-Z]{3}$'),
  description       text CHECK (description IS NULL OR char_length(description) <= 500),
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES users (id),
  source            text NOT NULL CHECK (source IN ('BOT', 'MINIAPP', 'SYSTEM')),
  idempotency_key   text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  reverses_entry_id uuid,
  interpretation_id uuid,
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_amount_check CHECK (
    (type IN ('DEBT', 'PAYMENT') AND amount > 0 AND amount <= 10000000000)
    OR (type = 'ADJUSTMENT' AND amount <> 0 AND abs(amount) <= 10000000000)
  ),
  CONSTRAINT ledger_reversal_type_check CHECK (reverses_entry_id IS NULL OR type = 'ADJUSTMENT'),
  CONSTRAINT ledger_occurred_check CHECK (
    occurred_at <= created_at AND occurred_at >= created_at - interval '365 days'
  ),
  CONSTRAINT ledger_idempotency_uq UNIQUE (business_id, idempotency_key),
  -- Mijoz va biznes mosligi DB darajasida (TT §26): boshqa biznes mijoziga yozib bo'lmaydi
  FOREIGN KEY (business_id, customer_id) REFERENCES customers (business_id, id),
  UNIQUE (business_id, customer_id, id),
  -- Storno original bilan bir xil biznes va mijozga tegishli bo'lishi shart
  FOREIGN KEY (business_id, customer_id, reverses_entry_id)
    REFERENCES ledger_entries (business_id, customer_id, id),
  -- Bitta yozuv faqat bir marta storno qilinadi
  CONSTRAINT ledger_reverses_once_uq UNIQUE (reverses_entry_id)
);
CREATE INDEX ledger_customer_idx ON ledger_entries (business_id, customer_id, seq DESC);
CREATE INDEX ledger_business_created_idx ON ledger_entries (business_id, created_at DESC);

ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY ledger_entries_select ON ledger_entries FOR SELECT USING (business_id = app_business_id());
CREATE POLICY ledger_entries_insert ON ledger_entries FOR INSERT WITH CHECK (business_id = app_business_id());

-- O'zgarmaslik: egasiga ham (trigger), app/system rollariga esa grant yo'q
CREATE TRIGGER ledger_entries_immutable BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER ledger_entries_no_truncate BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_modification();

-- Storno qoidalari (CHECK/FK yetmaydigan qismi): stornoni stornolab bo'lmaydi, summa teskari
CREATE FUNCTION ledger_check_reversal() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_target ledger_entries%ROWTYPE;
BEGIN
  IF NEW.reverses_entry_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_target FROM ledger_entries WHERE id = NEW.reverses_entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'storno uchun original yozuv topilmadi' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF v_target.reverses_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'storno yozuvini qayta storno qilib bo''lmaydi' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.amount <> -v_target.delta THEN
    RAISE EXCEPTION 'storno summasi originalning teskarisi bo''lishi kerak' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ledger_entries_check_reversal BEFORE INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_check_reversal();

-- Balans proyeksiyasi ledger bilan BIR tranzaksiyada yangilanadi. balance >= 0 CHECK buzilsa
-- butun INSERT (va tranzaksiya) bekor bo'ladi: ortiqcha to'lov hech qachon yozilmaydi.
CREATE FUNCTION ledger_apply_to_balance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE customer_balances
     SET balance = balance + NEW.delta, last_entry_id = NEW.id, updated_at = now()
   WHERE customer_id = NEW.customer_id AND business_id = NEW.business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mijoz balans qatori topilmadi' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ledger_entries_apply_balance AFTER INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_apply_to_balance();
