import crypto from 'crypto';
import { query } from '../db/pool.js';
import { config } from '../config/index.js';
import { generatePaymentToken } from '../utils/tokens.js';
import { NotFound, AppError } from '../utils/errors.js';

/**
 * Create a one-time, expiring payment link for a debt's outstanding amount.
 */
export const createPaymentLink = async (debtId) => {
  const { rows } = await query('SELECT * FROM debts WHERE id = $1', [debtId]);
  const debt = rows[0];
  if (!debt) throw NotFound('Qarz topilmadi');
  if (debt.status === 'paid') throw new AppError('Qarz yopilgan', 409, 'ALREADY_PAID');

  const outstanding = Number(debt.amount) - Number(debt.paid_amount);
  const token = generatePaymentToken(debtId);
  const expiresAt = new Date(Date.now() + config.paymentLinkTtlHours * 3600 * 1000);

  // invalidate previous active links for this debt
  await query(
    `UPDATE payment_links SET status = 'expired' WHERE debt_id = $1 AND status = 'active'`,
    [debtId]
  );

  await query(
    `INSERT INTO payment_links (debt_id, token, amount, status, expires_at)
     VALUES ($1,$2,$3,'active',$4)`,
    [debtId, token, outstanding, expiresAt]
  );

  return {
    url: `${config.publicBaseUrl}/pay/${token}`,
    token,
    amount: outstanding,
    expiresAt,
  };
};

/**
 * Resolve a payment token to an active link (validates status + expiry).
 */
export const resolvePaymentLink = async (token) => {
  const { rows } = await query('SELECT * FROM payment_links WHERE token = $1', [token]);
  const link = rows[0];
  if (!link) throw NotFound('Havola topilmadi');
  if (link.status !== 'active') throw new AppError('Havola ishlatilgan yoki bekor qilingan', 410, 'LINK_INACTIVE');
  if (new Date(link.expires_at) < new Date()) {
    await query(`UPDATE payment_links SET status = 'expired' WHERE id = $1`, [link.id]);
    throw new AppError('Havola muddati tugagan', 410, 'LINK_EXPIRED');
  }
  return link;
};

/**
 * Verify a Click webhook signature (Prepare/Complete).
 * Click signs with md5 of a concatenation of params + secret key.
 */
export const verifyClickSignature = (params) => {
  // Fail closed. With no secret configured the md5 below is computed over
  // entirely public values, so anyone could compute a matching sign_string and
  // have arbitrary debts marked as paid. An unconfigured integration must
  // reject every callback, not accept every callback.
  if (!config.click.secretKey) return false;

  const {
    click_trans_id, service_id, merchant_trans_id,
    merchant_prepare_id, amount, action, sign_time, sign_string,
  } = params;

  if (typeof sign_string !== 'string' || sign_string.length === 0) return false;

  // Reject callbacks aimed at a different merchant service outright.
  if (config.click.serviceId && String(service_id) !== String(config.click.serviceId)) {
    return false;
  }

  // Complete step includes merchant_prepare_id, Prepare step does not
  const base =
    `${click_trans_id}${service_id}${config.click.secretKey}${merchant_trans_id}` +
    `${merchant_prepare_id ?? ''}${amount}${action}${sign_time}`;

  const expected = crypto.createHash('md5').update(base).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(sign_string.toLowerCase(), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
