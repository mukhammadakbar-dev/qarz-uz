import bcrypt from 'bcryptjs';
import { query, withTransaction } from '../db/pool.js';
import { config } from '../config/index.js';
import { signAccessToken, signRefreshToken } from '../utils/tokens.js';
import { normalizePhone } from '../utils/phone.js';
import { AppError, Unauthorized } from '../utils/errors.js';
import { issueOtp, verifyOtp } from './otp.service.js';
import { sendSms } from './sms.service.js';

const issueTokens = (user) => ({
  accessToken: signAccessToken({ sub: user.id, role: user.role }),
  refreshToken: signRefreshToken({ sub: user.id, role: user.role }),
});

/**
 * Register a shop owner: creates user + shop + trial subscription + sms balance + reminder defaults.
 */
/**
 * STEP 1 of web registration — send a confirmation code to the phone.
 *
 * Without this, anyone could register an account against a phone number they
 * do not control (e.g. a real shop owner's number) and keep a password that
 * survives any later Telegram re-linking. Proving control of the number first
 * closes that hole.
 *
 * Unlike the telegram-link flow we do NOT hide whether the phone exists: the
 * caller needs to know the number is taken so they can log in instead.
 */
export const requestRegisterOtp = async ({ phone }) => {
  const normPhone = normalizePhone(phone);
  if (!normPhone) throw new AppError('Telefon raqami notogri', 422, 'BAD_PHONE');

  const { rows } = await query('SELECT id FROM users WHERE phone = $1', [normPhone]);
  if (rows[0]) {
    throw new AppError(
      'Bu telefon raqami allaqachon royxatdan otgan. Kirish sahifasidan foydalaning.',
      409,
      'PHONE_TAKEN'
    );
  }

  const { code, ttlMinutes } = await issueOtp(normPhone, 'register');
  await sendSms(
    normPhone,
    `Qarz.uz: royxatdan otish uchun tasdiqlash kodi ${code}. Kod ${ttlMinutes} daqiqa amal qiladi. Bu kodni hech kimga bermang.`
  );

  return { sent: true };
};

/**
 * Register a shop owner: creates user + shop + trial subscription + sms balance + reminder defaults.
 *
 * `skipOtp` is used only by the Telegram bot, where possession of the Telegram
 * session plus a shared contact already proves control of the number.
 */
export const registerShopOwner = async ({ phone, password, fullName, shopName, otp, skipOtp = false }) => {
  const normPhone = normalizePhone(phone);
  if (!normPhone) throw new AppError('Telefon raqami noto\'g\'ri', 422, 'BAD_PHONE');

  // Proof of phone ownership before an account (and password) is created.
  if (!skipOtp) await verifyOtp(normPhone, otp, 'register');

  const hash = await bcrypt.hash(password, 10);

  return withTransaction(async (client) => {
    const u = await client.query(
      `INSERT INTO users (role, phone, password_hash, full_name)
       VALUES ('shop_owner', $1, $2, $3) RETURNING *`,
      [normPhone, hash, fullName || null]
    );
    const user = u.rows[0];

    const s = await client.query(
      `INSERT INTO shops (owner_id, name) VALUES ($1, $2) RETURNING *`,
      [user.id, shopName]
    );
    const shop = s.rows[0];

    const trialEnd = new Date(Date.now() + config.trialDays * 24 * 3600 * 1000);
    await client.query(
      `INSERT INTO subscriptions (shop_id, plan, status, ends_at)
       VALUES ($1, 'start', 'trial', $2)`,
      [shop.id, trialEnd]
    );

    await client.query(
      `INSERT INTO sms_balance (shop_id, monthly_limit, remaining)
       VALUES ($1, $2, $2)`,
      [shop.id, config.defaultSmsLimit]
    );

    await client.query(
      `INSERT INTO reminder_settings (shop_id) VALUES ($1)`,
      [shop.id]
    );

    return { user, shop, tokens: issueTokens(user) };
  });
};

/**
 * Register a personal (free) user.
 *
 * `skipOtp` is used only by the Telegram bot (see registerShopOwner).
 */
export const registerPersonal = async ({ phone, password, fullName, otp, skipOtp = false }) => {
  const normPhone = normalizePhone(phone);
  if (!normPhone) throw new AppError('Telefon raqami noto\'g\'ri', 422, 'BAD_PHONE');

  // Proof of phone ownership before an account (and password) is created.
  if (!skipOtp) await verifyOtp(normPhone, otp, 'register');

  const hash = await bcrypt.hash(password, 10);
  const u = await query(
    `INSERT INTO users (role, phone, password_hash, full_name)
     VALUES ('personal', $1, $2, $3) RETURNING *`,
    [normPhone, hash, fullName || null]
  );
  return { user: u.rows[0], tokens: issueTokens(u.rows[0]) };
};

/**
 * Login with phone + password (web). Works for any role.
 */
export const login = async ({ phone, password }) => {
  const normPhone = normalizePhone(phone);
  const { rows } = await query('SELECT * FROM users WHERE phone = $1', [normPhone]);
  const user = rows[0];
  if (!user || !user.password_hash) throw Unauthorized('Login yoki parol xato');
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) throw Unauthorized('Login yoki parol xato');
  if (!user.is_active) throw Unauthorized('Akkaunt bloklangan');
  return { user, tokens: issueTokens(user) };
};

/**
 * STEP 1 — Request a Telegram link: send a 6-digit OTP by SMS.
 *
 * Security: responds identically whether or not the phone exists, so the
 * endpoint cannot be used to enumerate registered numbers. The OTP itself
 * is what proves the caller controls the phone.
 */
export const requestTelegramLink = async ({ phone }) => {
  const normPhone = normalizePhone(phone);
  if (!normPhone) throw new AppError('Telefon raqami noto\'g\'ri', 422, 'BAD_PHONE');

  const { rows } = await query('SELECT id FROM users WHERE phone = $1', [normPhone]);
  if (!rows[0]) {
    // no account: pretend success, send nothing
    return { sent: true };
  }

  const { code, ttlMinutes } = await issueOtp(normPhone, 'telegram_link');
  await sendSms(
    normPhone,
    `Qarz.uz: Telegram botni ulash uchun tasdiqlash kodi ${code}. Kod ${ttlMinutes} daqiqa amal qiladi. Bu kodni hech kimga bermang.`
  );

  return { sent: true };
};

/**
 * STEP 2 — Confirm the link with the OTP, then bind telegram_id.
 * Only after a valid OTP are tokens issued.
 */
export const confirmTelegramLink = async ({ phone, telegramId, otp }) => {
  const normPhone = normalizePhone(phone);
  if (!normPhone) throw new AppError('Telefon raqami noto\'g\'ri', 422, 'BAD_PHONE');

  // throws on expired / wrong / too many attempts
  await verifyOtp(normPhone, otp, 'telegram_link');

  const { rows } = await query('SELECT * FROM users WHERE phone = $1', [normPhone]);
  const user = rows[0];
  if (!user) throw new AppError('Foydalanuvchi topilmadi', 404, 'NOT_FOUND');
  if (!user.is_active) throw Unauthorized('Akkaunt bloklangan');

  // a telegram_id may only belong to one account: detach it from any other
  await query(
    'UPDATE users SET telegram_id = NULL WHERE telegram_id = $1 AND id <> $2',
    [telegramId, user.id]
  );
  await query('UPDATE users SET telegram_id = $1, updated_at = now() WHERE id = $2', [
    telegramId,
    user.id,
  ]);

  return {
    linked: true,
    user: { id: user.id, role: user.role, phone: user.phone, telegram_id: telegramId },
    tokens: issueTokens(user),
  };
};
