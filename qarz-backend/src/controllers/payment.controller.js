import { asyncHandler } from '../utils/errors.js';
import { query } from '../db/pool.js';
import {
  resolvePaymentLink,
  verifyClickSignature,
} from '../services/payment.service.js';
import { recordPayment } from '../services/debt.service.js';

// Click error codes
const CLICK_OK = 0;
const CLICK_SIGN_FAIL = -1;
const CLICK_BAD_AMOUNT = -2;
const CLICK_ALREADY_PAID = -4;
const CLICK_TX_NOT_FOUND = -6;

/**
 * Public: render/return payment link info for a token (used by the pay page).
 */
export const getPayInfo = asyncHandler(async (req, res) => {
  const link = await resolvePaymentLink(req.params.token);
  const { rows } = await query(
    `SELECT dt.id, dt.amount, dt.paid_amount, d.full_name
     FROM debts dt JOIN debtors d ON d.id = dt.debtor_id
     WHERE dt.id = $1`,
    [link.debt_id]
  );
  res.json({
    token: link.token,
    amount: Number(link.amount),
    debtor: rows[0]?.full_name,
    expiresAt: link.expires_at,
  });
});

/**
 * Click Prepare webhook — validates signature and reserves the transaction.
 */
export const clickPrepare = asyncHandler(async (req, res) => {
  const p = req.body;
  if (!verifyClickSignature(p)) {
    return res.json({ error: CLICK_SIGN_FAIL, error_note: 'Invalid signature' });
  }
  // merchant_trans_id carries our payment-link token
  try {
    const link = await resolvePaymentLink(p.merchant_trans_id);
    return res.json({
      click_trans_id: p.click_trans_id,
      merchant_trans_id: p.merchant_trans_id,
      merchant_prepare_id: link.id,
      error: CLICK_OK,
      error_note: 'Success',
    });
  } catch {
    return res.json({ error: CLICK_TX_NOT_FOUND, error_note: 'Order not found' });
  }
});

/**
 * Click Complete webhook — verifies signature, records payment, closes link.
 */
export const clickComplete = asyncHandler(async (req, res) => {
  const p = req.body;
  if (!verifyClickSignature(p)) {
    return res.json({ error: CLICK_SIGN_FAIL, error_note: 'Invalid signature' });
  }

  // Look the link up directly (no status filter) so an already-used link can
  // still be answered correctly when Click retries the Complete callback.
  const linkRows = await query('SELECT * FROM payment_links WHERE token = $1', [
    p.merchant_trans_id,
  ]);
  const link = linkRows.rows[0];
  if (!link) {
    return res.json({ error: CLICK_TX_NOT_FOUND, error_note: 'Order not found' });
  }

  // Idempotency: if this exact transaction was already recorded, acknowledge it
  // as already-paid instead of reporting "not found".
  const dup = await query(
    `SELECT 1 FROM payments
     WHERE debt_id = $1 AND transaction_id = $2 AND method = 'click' LIMIT 1`,
    [link.debt_id, String(p.click_trans_id)]
  );
  if (link.status === 'used' && dup.rows.length) {
    return res.json({
      click_trans_id: p.click_trans_id,
      merchant_trans_id: p.merchant_trans_id,
      merchant_confirm_id: link.id,
      error: CLICK_ALREADY_PAID,
      error_note: 'Already paid',
    });
  }

  // Click sends error=0 when the user successfully paid
  if (Number(p.error) !== 0) {
    return res.json({
      click_trans_id: p.click_trans_id,
      merchant_trans_id: p.merchant_trans_id,
      error: p.error,
      error_note: 'Payment failed',
    });
  }

  // Amount must match what the link was issued for
  if (Math.abs(Number(p.amount) - Number(link.amount)) > 0.01) {
    return res.json({
      click_trans_id: p.click_trans_id,
      merchant_trans_id: p.merchant_trans_id,
      error: CLICK_BAD_AMOUNT,
      error_note: 'Incorrect parameter amount',
    });
  }

  // Reject links that expired before payment completed
  if (link.status === 'expired' || new Date(link.expires_at) < new Date()) {
    return res.json({
      click_trans_id: p.click_trans_id,
      merchant_trans_id: p.merchant_trans_id,
      error: CLICK_TX_NOT_FOUND,
      error_note: 'Order expired',
    });
  }

  // Record payment against the debt and mark link used.
  //
  // Two concurrent retries of the same callback both get past the duplicate
  // check above; the unique index on (debt_id, method, transaction_id) makes
  // the loser fail here. That is the same situation as the pre-checked
  // duplicate, so answer Click identically instead of returning a 500.
  try {
    await recordPayment({
      debtId: link.debt_id,
      amount: Number(p.amount),
      method: 'click',
      transactionId: String(p.click_trans_id),
    });
  } catch (err) {
    if (err.code === 'DUPLICATE_PAYMENT' || err.code === 'ALREADY_PAID') {
      await query(`UPDATE payment_links SET status = 'used' WHERE id = $1`, [link.id]);
      return res.json({
        click_trans_id: p.click_trans_id,
        merchant_trans_id: p.merchant_trans_id,
        merchant_confirm_id: link.id,
        error: CLICK_ALREADY_PAID,
        error_note: 'Already paid',
      });
    }
    throw err;
  }
  await query(`UPDATE payment_links SET status = 'used' WHERE id = $1`, [link.id]);

  // confirmation to debtor happens via notification worker / could be triggered here

  return res.json({
    click_trans_id: p.click_trans_id,
    merchant_trans_id: p.merchant_trans_id,
    merchant_confirm_id: link.id,
    error: CLICK_OK,
    error_note: 'Success',
  });
});
