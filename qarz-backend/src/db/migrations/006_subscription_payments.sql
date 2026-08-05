-- ============================================================
-- Migration 006 — record what shops pay the platform
--
-- Until Click is integrated, subscriptions are activated by hand: the owner
-- messages the admin, pays, and the admin extends the period. Without a record
-- of that, "how much came in this month?" has no answer, and the only trace of
-- a payment is the admin's memory.
--
-- Note this is NOT the existing `payments` table. That one records a debtor
-- paying a shop; this records a shop paying us. Different parties, different
-- lifecycle — hence a separate table rather than a nullable column bolted on.
-- ============================================================

CREATE TABLE IF NOT EXISTS subscription_payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id        UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,

  -- 0 is allowed on purpose: a comped extension (apology, pilot, goodwill) is
  -- still an event worth recording, and forcing a fake amount would corrupt
  -- the revenue figures.
  amount_uzs     NUMERIC(14,2) NOT NULL CHECK (amount_uzs >= 0),

  -- Reuses the existing payment_method enum, so when Click is switched on its
  -- callbacks land in this same table as method='click' and the history stays
  -- continuous instead of splitting into a before and an after.
  method         payment_method NOT NULL DEFAULT 'manual',
  transaction_id VARCHAR(120),

  -- What was bought, and the period it covers. Denormalised deliberately:
  -- subscriptions.plan changes on the next renewal, and this row must keep
  -- saying what was actually sold at the time.
  plan           sub_plan NOT NULL,
  months         INTEGER NOT NULL CHECK (months > 0),
  period_start   TIMESTAMPTZ NOT NULL,
  period_end     TIMESTAMPTZ NOT NULL,

  note           TEXT,

  -- Which admin recorded it. ON DELETE SET NULL: removing an employee's
  -- account must not delete the financial record they entered.
  recorded_by    UUID REFERENCES users(id) ON DELETE SET NULL,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sub_payments_shop
  ON subscription_payments (shop_id, created_at DESC);

-- Revenue reporting scans by date across all shops.
CREATE INDEX IF NOT EXISTS idx_sub_payments_created
  ON subscription_payments (created_at);

-- Same guard as uq_payments_txn on the debtor-payment table: a gateway retries
-- its callback until it gets an answer it likes, and two concurrent retries
-- would both pass an application-level "already recorded?" check. Partial,
-- because manual entries legitimately have no transaction id — and two cash
-- payments from the same shop on the same day are a real thing.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sub_payments_txn
  ON subscription_payments (method, transaction_id)
  WHERE transaction_id IS NOT NULL;
