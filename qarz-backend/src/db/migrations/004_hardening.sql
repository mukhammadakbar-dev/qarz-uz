-- ============================================================
-- Migration 004 — additive only, backward compatible
--
--   * payments: DB-level idempotency for gateway callbacks
--   * otp_codes: index for the Telegram registration handshake lookup
--   * notifications: index the reminder sweep depends on
--   * sms_balance: reserve-then-send accounting
-- ============================================================

-- ---------- Payment idempotency ----------
-- Click retries its Complete callback until it gets an answer it likes. The
-- application checks for a duplicate before inserting, but two concurrent
-- retries both pass that check and both record a payment. A unique index makes
-- the second insert fail instead, so a retry can never double-credit a debt.
-- Partial: manual/cash payments legitimately have no transaction id.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_txn
  ON payments (debt_id, method, transaction_id)
  WHERE transaction_id IS NOT NULL;

-- ---------- Telegram registration handshake ----------
-- Looked up by token on every status poll (every 2s per pending registration).
CREATE INDEX IF NOT EXISTS idx_otp_code_hash
  ON otp_codes (code_hash, purpose);

-- ---------- Reminder sweep ----------
-- The sweep runs two correlated sub-selects plus a same-day duplicate check
-- against notifications for every candidate debt; without this it is a
-- sequential scan per row.
CREATE INDEX IF NOT EXISTS idx_notifications_debt_status
  ON notifications (debt_id, status, created_at);

-- ---------- Debts due-date sweep ----------
CREATE INDEX IF NOT EXISTS idx_debts_status_due
  ON debts (status, due_date);
