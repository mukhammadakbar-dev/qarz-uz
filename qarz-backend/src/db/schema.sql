-- ============================================================
-- Qarzlarni boshqarish tizimi — DB schema
-- Multi-tenant: har bir do'kon (shop) o'z ma'lumotlarini ko'radi.
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid()

-- ---------- ENUM types ----------
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('super_admin', 'shop_owner', 'personal', 'staff');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE debt_direction AS ENUM ('given', 'taken'); -- given: menga qarzdor, taken: men qarzdorman
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE debt_status AS ENUM ('open', 'partial', 'paid', 'overdue');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE sub_status AS ENUM ('trial', 'active', 'expired', 'blocked');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE sub_plan AS ENUM ('start', 'pro', 'business');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE notif_channel AS ENUM ('telegram', 'sms');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE notif_status AS ENUM ('pending', 'sent', 'failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE paylink_status AS ENUM ('active', 'used', 'expired');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM ('cash', 'click', 'payme', 'manual');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ---------- Users (tizim foydalanuvchilari) ----------
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role          user_role NOT NULL,
  phone         VARCHAR(20) UNIQUE,
  telegram_id   BIGINT UNIQUE,
  password_hash TEXT,
  -- Anything issued before this instant is refused by /auth/refresh, so a
  -- password change ends every other session instead of leaving 30-day refresh
  -- tokens alive. NULL = never changed.
  password_changed_at TIMESTAMPTZ,
  full_name     VARCHAR(120),
  -- staff belongs to a shop owner; NULL for owners/personal/super_admin
  parent_shop_id UUID,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Shops (do'konlar) ----------
CREATE TABLE IF NOT EXISTS shops (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       VARCHAR(160) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- staff -> shop FK (added after shops exists)
DO $$ BEGIN
  ALTER TABLE users
    ADD CONSTRAINT fk_users_parent_shop
    FOREIGN KEY (parent_shop_id) REFERENCES shops(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ---------- Subscriptions (obunalar) ----------
CREATE TABLE IF NOT EXISTS subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  plan        sub_plan NOT NULL DEFAULT 'start',
  status      sub_status NOT NULL DEFAULT 'trial',
  starts_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at     TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_shop ON subscriptions(shop_id);

-- ---------- Plans (tarif ta'riflari — super admin sozlaydi) ----------
CREATE TABLE IF NOT EXISTS plans (
  code            sub_plan PRIMARY KEY,
  name            VARCHAR(60) NOT NULL,
  price_uzs       BIGINT NOT NULL DEFAULT 0,
  max_debtors     INTEGER,        -- NULL = unlimited
  max_staff       INTEGER NOT NULL DEFAULT 0,
  monthly_sms     INTEGER NOT NULL DEFAULT 30,
  advanced_stats  BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- SmsBalance ----------
CREATE TABLE IF NOT EXISTS sms_balance (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id        UUID NOT NULL UNIQUE REFERENCES shops(id) ON DELETE CASCADE,
  monthly_limit  INTEGER NOT NULL DEFAULT 30,
  remaining      INTEGER NOT NULL DEFAULT 30,
  extra_package  INTEGER NOT NULL DEFAULT 0,   -- purchased extra SMS
  period_start   DATE NOT NULL DEFAULT CURRENT_DATE,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Debtors (qarzdor shaxslar) ----------
-- owner_id: shop owner OR personal user who owns this contact
CREATE TABLE IF NOT EXISTS debtors (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shop_id     UUID REFERENCES shops(id) ON DELETE CASCADE, -- NULL for personal users
  full_name   VARCHAR(120) NOT NULL,
  phone       VARCHAR(20),
  telegram_id BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_debtors_owner ON debtors(owner_id);
CREATE INDEX IF NOT EXISTS idx_debtors_shop ON debtors(shop_id);
CREATE INDEX IF NOT EXISTS idx_debtors_phone ON debtors(phone);

-- ---------- Debts (qarzlar) ----------
CREATE TABLE IF NOT EXISTS debts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  debtor_id    UUID NOT NULL REFERENCES debtors(id) ON DELETE CASCADE,
  shop_id      UUID REFERENCES shops(id) ON DELETE CASCADE,
  direction    debt_direction NOT NULL DEFAULT 'given',
  amount       NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  paid_amount  NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  note         TEXT,
  issued_at    DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date     DATE,
  status       debt_status NOT NULL DEFAULT 'open',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_debts_debtor ON debts(debtor_id);
CREATE INDEX IF NOT EXISTS idx_debts_shop ON debts(shop_id);
CREATE INDEX IF NOT EXISTS idx_debts_due ON debts(due_date) WHERE status <> 'paid';

-- ---------- Payments (to'lovlar) ----------
CREATE TABLE IF NOT EXISTS payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  debt_id        UUID NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  amount         NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method         payment_method NOT NULL DEFAULT 'manual',
  transaction_id VARCHAR(120),
  paid_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_debt ON payments(debt_id);

-- ---------- PaymentLinks (to'lov linklari) ----------
CREATE TABLE IF NOT EXISTS payment_links (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  debt_id     UUID NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  token       VARCHAR(255) NOT NULL UNIQUE,
  amount      NUMERIC(14,2) NOT NULL,
  status      paylink_status NOT NULL DEFAULT 'active',
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_paylinks_token ON payment_links(token);

-- ---------- Notifications (bildirishnomalar) ----------
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  debtor_id   UUID NOT NULL REFERENCES debtors(id) ON DELETE CASCADE,
  debt_id     UUID REFERENCES debts(id) ON DELETE CASCADE,
  channel     notif_channel NOT NULL,
  body        TEXT NOT NULL,
  status      notif_status NOT NULL DEFAULT 'pending',
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_debtor ON notifications(debtor_id);

-- ---------- Announcements (platform -> shop owners) ----------
-- Stored rather than only pushed, so the web app has something to show and an
-- owner who missed the Telegram message can still find it. See migration 009.
CREATE TABLE IF NOT EXISTS announcements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  body        TEXT NOT NULL,
  target_type VARCHAR(32) NOT NULL DEFAULT 'all',
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_announcements_created ON announcements (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_announcements_target ON announcements (target_type);

CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_announcement_reads_user ON announcement_reads (user_id);

-- ---------- Reminder settings (per shop) ----------
CREATE TABLE IF NOT EXISTS reminder_settings (
  shop_id       UUID PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
  days_before   INTEGER NOT NULL DEFAULT 1,    -- N kun oldin
  repeat_count  INTEGER NOT NULL DEFAULT 2,    -- necha marta
  -- No {link} by default: the placeholder only resolves to something usable
  -- once Click is live (see config.click.enabled). Until then it rendered an
  -- URL that opened raw JSON for the customer. The placeholder still works —
  -- it is simply opt-in now.
  template      TEXT NOT NULL DEFAULT 'Hurmatli {name}, {amount} so''m qarzingiz muddati {due} da tugaydi.',
  prefer_channel notif_channel NOT NULL DEFAULT 'telegram',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- DailySales (kunlik savdo) ----------
CREATE TABLE IF NOT EXISTS daily_sales (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  sale_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  cash_card     NUMERIC(14,2) NOT NULL DEFAULT 0, -- qo'lda kiritilgan naqd/karta
  debt_given    NUMERIC(14,2) NOT NULL DEFAULT 0, -- avtomatik: o'sha kun yozilgan qarzlar
  total         NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shop_id, sale_date)
);
CREATE INDEX IF NOT EXISTS idx_daily_sales_shop_date ON daily_sales(shop_id, sale_date);

-- ---------- Audit log (super admin) ----------
CREATE TABLE IF NOT EXISTS audit_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  action     VARCHAR(120) NOT NULL,
  meta       JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
