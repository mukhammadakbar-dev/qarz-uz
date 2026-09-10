import crypto from 'crypto';
import { query } from '../db/pool.js';
import { config } from '../config/index.js';
import { AppError } from '../utils/errors.js';

const OTP_TTL_MINUTES = 5;
const MAX_ATTEMPTS = 5;

/** Hash an OTP with HMAC-SHA256 — never store plaintext. */
const hashCode = (phone, code) =>
  crypto
    .createHmac('sha256', config.jwt.paymentLinkSecret)
    .update(`${phone}:${code}`)
    .digest('hex');

/** Cryptographically random 6-digit code (000000–999999). */
const generateCode = () =>
  String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

/**
 * Create a new OTP for a phone and hand it to `deliver` for sending.
 *
 * The previous code is invalidated only once delivery has succeeded. It used to
 * happen first, which quietly cost people their working code: request an SMS,
 * receive it, then tap "Telegram orqali kod olish" — if that send failed (no
 * Gateway balance, say) the request errored AND the SMS code they were holding
 * had already been burned. Neither code worked, and re-requesting ran into the
 * 5-per-hour limiter.
 *
 * `deliver` receives the plaintext code and must resolve to { ok } (matching
 * sendSms / sendTelegramCode). Anything falsy — or a throw — leaves the earlier
 * code untouched and the new one unwritten.
 */
export const issueOtp = async (phone, purpose = 'telegram_link', deliver = null) => {
  const code = generateCode();
  const codeHash = hashCode(phone, code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
  const ttlMinutes = OTP_TTL_MINUTES;

  if (deliver) {
    const result = await deliver({ code, expiresAt, ttlMinutes });
    if (!result?.ok) {
      return { ok: false, error: result?.error || 'Yuborib bo\'lmadi', ttlMinutes };
    }
  }

  // burn previous outstanding codes so only the newest works
  await query(
    `UPDATE otp_codes SET consumed_at = now()
     WHERE phone = $1 AND purpose = $2 AND consumed_at IS NULL`,
    [phone, purpose]
  );

  await query(
    `INSERT INTO otp_codes (phone, code_hash, purpose, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [phone, codeHash, purpose, expiresAt]
  );

  return { ok: true, code, expiresAt, ttlMinutes };
};

/**
 * Verify an OTP. Throws AppError on any failure.
 * Consumes the code on success so it cannot be replayed.
 */
export const verifyOtp = async (phone, code, purpose = 'telegram_link') => {
  const { rows } = await query(
    `SELECT * FROM otp_codes
     WHERE phone = $1 AND purpose = $2 AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [phone, purpose]
  );
  const rec = rows[0];
  if (!rec) throw new AppError('Kod topilmadi yoki allaqachon ishlatilgan', 400, 'OTP_NOT_FOUND');

  if (new Date(rec.expires_at) < new Date()) {
    await query(`UPDATE otp_codes SET consumed_at = now() WHERE id = $1`, [rec.id]);
    throw new AppError('Kod muddati tugagan', 400, 'OTP_EXPIRED');
  }

  if (rec.attempts >= MAX_ATTEMPTS) {
    await query(`UPDATE otp_codes SET consumed_at = now() WHERE id = $1`, [rec.id]);
    throw new AppError('Juda ko\'p noto\'g\'ri urinish. Yangi kod so\'rang', 429, 'OTP_LOCKED');
  }

  const expected = hashCode(phone, String(code));
  const given = Buffer.from(rec.code_hash, 'utf8');
  const mine = Buffer.from(expected, 'utf8');
  const ok = given.length === mine.length && crypto.timingSafeEqual(given, mine);

  if (!ok) {
    await query(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1`, [rec.id]);
    const left = MAX_ATTEMPTS - (rec.attempts + 1);
    throw new AppError(
      `Kod noto'g'ri. Qolgan urinishlar: ${Math.max(left, 0)}`,
      400,
      'OTP_INVALID'
    );
  }

  await query(`UPDATE otp_codes SET consumed_at = now() WHERE id = $1`, [rec.id]);
  return true;
};

/** Housekeeping: drop long-expired rows. */
export const purgeExpiredOtps = () =>
  query(`DELETE FROM otp_codes WHERE expires_at < now() - INTERVAL '1 day'`);
