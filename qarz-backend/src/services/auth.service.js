import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { query, withTransaction } from '../db/pool.js';
import { config } from '../config/index.js';
import { signAccessToken, signRefreshToken } from '../utils/tokens.js';
import { normalizePhone } from '../utils/phone.js';
import { AppError, Unauthorized } from '../utils/errors.js';
import { issueOtp, verifyOtp } from './otp.service.js';
import { sendSms } from './sms.service.js';

/**
 * otp_codes rows holding a Telegram registration handshake. The `code_hash`
 * column carries the (already unguessable, 256-bit) verify token itself.
 */
const VERIFY_PURPOSE = 'tg_verify';
const VERIFY_TOKEN_TTL_MINUTES = 15;

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
export const requestRegisterOtp = async ({ phone, channel = 'sms' }) => {
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

  if (channel === 'telegram') {
    // The Telegram channel proves ownership by having the user share their
    // contact with our bot; no code is ever put on the wire. See
    // confirmRegisterVerifyToken below for the second half of the handshake.
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_MINUTES * 60 * 1000);

    // burn any earlier outstanding handshake for this phone
    await query(
      `UPDATE otp_codes SET consumed_at = now()
       WHERE phone = $1 AND purpose = $2 AND consumed_at IS NULL`,
      [normPhone, VERIFY_PURPOSE]
    );
    await query(
      `INSERT INTO otp_codes (phone, code_hash, purpose, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [normPhone, verifyToken, VERIFY_PURPOSE, expiresAt]
    );

    return {
      sent: true,
      channel: 'telegram',
      verifyToken,
      botUsername: config.telegram.botUsername,
      deepLink: `https://t.me/${config.telegram.botUsername}?start=verify_${verifyToken}`,
    };
  }

  const isSmsConfigured = Boolean(config.eskiz.email && config.eskiz.password);
  if (!isSmsConfigured && config.env === 'production') {
    throw new AppError(
      'SMS orqali yuborish hozircha ishlamayapti, iltimos Telegram orqali urinib koring.',
      503,
      'SMS_NOT_CONFIGURED'
    );
  }
  const { code, ttlMinutes } = await issueOtp(normPhone, 'register');
  await sendSms(
    normPhone,
    `TemirDaftar.uz: royxatdan otish uchun tasdiqlash kodi ${code}. Kod ${ttlMinutes} daqiqa amal qiladi. Bu kodni hech kimga bermang.`
  );
  return { sent: true, channel: 'sms' };
};

/**
 * Register a shop owner: creates user + shop + trial subscription + sms balance + reminder defaults.
 *
 * `skipOtp` is used only by the Telegram bot, where possession of the Telegram
 * session plus a shared contact already proves control of the number.
 */
export const registerShopOwner = async ({ phone, password, fullName, shopName, otp, verifyToken, skipOtp = false, telegramId = null }) => {
  const normPhone = normalizePhone(phone);
  if (!normPhone) throw new AppError('Telefon raqami noto\'g\'ri', 422, 'BAD_PHONE');

  await assertPhoneOwnership(normPhone, { otp, verifyToken, skipOtp });

  const hash = await bcrypt.hash(password, 10);

  return withTransaction(async (client) => {
    const u = await client.query(
      `INSERT INTO users (role, phone, password_hash, full_name, telegram_id)
       VALUES ('shop_owner', $1, $2, $3, $4) RETURNING *`,
      [normPhone, hash, fullName || null, telegramId]
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
export const registerPersonal = async ({ phone, password, fullName, otp, verifyToken, skipOtp = false, telegramId = null }) => {
  const normPhone = normalizePhone(phone);
  if (!normPhone) throw new AppError('Telefon raqami noto\'g\'ri', 422, 'BAD_PHONE');

  await assertPhoneOwnership(normPhone, { otp, verifyToken, skipOtp });

  const hash = await bcrypt.hash(password, 10);
  const u = await query(
    `INSERT INTO users (role, phone, password_hash, full_name, telegram_id)
     VALUES ('personal', $1, $2, $3, $4) RETURNING *`,
    [normPhone, hash, fullName || null, telegramId]
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
    `TemirDaftar.uz: Telegram botni ulash uchun tasdiqlash kodi ${code}. Kod ${ttlMinutes} daqiqa amal qiladi. Bu kodni hech kimga bermang.`
  );

  // The code is NEVER returned to the caller: this endpoint is public and
  // unauthenticated, so echoing it back would let anyone request a code for
  // someone else's number, read it from the response, and complete
  // /telegram/confirm-link to bind their own Telegram account to it — a full
  // account takeover. The SMS is the only delivery channel.
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

const findVerifyToken = async (verifyToken) => {
  const { rows } = await query(
    `SELECT * FROM otp_codes WHERE code_hash = $1 AND purpose = $2 LIMIT 1`,
    [verifyToken, VERIFY_PURPOSE]
  );
  return rows[0] || null;
};

/**
 * Polled by the registration page while the user completes the Telegram side.
 *
 * Deliberately returns nothing but a boolean: the browser holding the verify
 * token is not yet proven to be the phone's owner, so it must never be handed
 * anything that could be replayed as proof. The token becomes usable as proof
 * only once the bot has confirmed it (consumeRegisterVerifyToken).
 */
export const getVerifyStatus = async (verifyToken) => {
  const rec = await findVerifyToken(verifyToken);
  if (!rec) return { verified: false };
  if (new Date(rec.expires_at) < new Date()) return { verified: false, expired: true };
  return { verified: Boolean(rec.consumed_at) };
};

/**
 * Called by our own Telegram bot (shared-secret authenticated) after the user
 * shared their contact card in an authenticated Telegram session.
 *
 * `phone` therefore comes from Telegram itself, not from the browser. Requiring
 * it to match the phone the registration was started for is what stops someone
 * from starting a registration against a number they do not own and completing
 * it from their own Telegram account.
 */
export const confirmVerifyToken = async (verifyToken, telegramId, phone) => {
  const normPhone = normalizePhone(phone);
  if (!normPhone) throw new AppError('Telefon raqami noto\'g\'ri', 422, 'BAD_PHONE');

  const rec = await findVerifyToken(verifyToken);
  if (!rec) throw new AppError('Token topilmadi', 404, 'TOKEN_NOT_FOUND');
  if (rec.consumed_at) throw new AppError('Token allaqachon ishlatilgan', 409, 'TOKEN_USED');
  if (new Date(rec.expires_at) < new Date()) {
    throw new AppError('Token muddati tugagan', 410, 'TOKEN_EXPIRED');
  }
  if (rec.phone !== normPhone) {
    throw new AppError(
      'Ulashilgan raqam ro\'yxatdan o\'tish boshlangan raqamga mos kelmadi.',
      403,
      'PHONE_MISMATCH'
    );
  }

  await query(
    `UPDATE otp_codes SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL`,
    [rec.id]
  );
  return { ok: true, phone: rec.phone, telegramId };
};

/**
 * Spend a confirmed verify token as proof of phone ownership at registration
 * time. Single-use: the row is deleted so the same handshake cannot register
 * twice.
 */
const consumeRegisterVerifyToken = async (normPhone, verifyToken) => {
  const rec = await findVerifyToken(verifyToken);
  if (!rec || rec.phone !== normPhone || !rec.consumed_at) {
    throw new AppError('Telefon raqami tasdiqlanmagan', 400, 'NOT_VERIFIED');
  }
  if (new Date(rec.expires_at) < new Date()) {
    throw new AppError('Tasdiqlash muddati tugagan, qaytadan boshlang', 400, 'OTP_EXPIRED');
  }
  const { rowCount } = await query('DELETE FROM otp_codes WHERE id = $1', [rec.id]);
  if (!rowCount) throw new AppError('Telefon raqami tasdiqlanmagan', 400, 'NOT_VERIFIED');
};

/**
 * Proof of phone ownership before an account (and password) is created:
 * an SMS OTP, a completed Telegram handshake, or the bot's own shared secret.
 */
const assertPhoneOwnership = async (normPhone, { otp, verifyToken, skipOtp }) => {
  if (skipOtp) return;
  if (verifyToken) return consumeRegisterVerifyToken(normPhone, verifyToken);
  await verifyOtp(normPhone, otp, 'register');
};

export const directLinkByContact = async ({ phone, telegramId }) => {
  const normPhone = normalizePhone(phone);
  if (!normPhone) throw new AppError('Telefon raqami noto\'g\'ri', 422, 'BAD_PHONE');

  let { rows } = await query('SELECT * FROM users WHERE phone = $1', [normPhone]);
  let user = rows[0];

  if (!user) {
    return { exists: false, phone: normPhone };
  }

  if (!user.is_active) throw Unauthorized('Akkaunt bloklangan');
  await query(
    'UPDATE users SET telegram_id = NULL WHERE telegram_id = $1 AND id <> $2',
    [telegramId, user.id]
  );
  await query('UPDATE users SET telegram_id = $1, updated_at = now() WHERE id = $2', [
    telegramId,
    user.id,
  ]);

  return {
    exists: true,
    linked: true,
    user: { id: user.id, role: user.role, phone: user.phone, telegram_id: telegramId },
    tokens: issueTokens(user),
  };
};


