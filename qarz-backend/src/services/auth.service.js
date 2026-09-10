import bcrypt from 'bcryptjs';
import { query, withTransaction } from '../db/pool.js';
import { config } from '../config/index.js';
import { signAccessToken, signRefreshToken } from '../utils/tokens.js';
import { normalizePhone } from '../utils/phone.js';
import { AppError, Unauthorized } from '../utils/errors.js';
import { issueOtp, verifyOtp } from './otp.service.js';
import { sendSms } from './sms.service.js';
import { sendTelegramCode, isTelegramGatewayConfigured } from './telegramGateway.service.js';


const issueTokens = (user) => ({
  accessToken: signAccessToken({ sub: user.id, role: user.role, phone: user.phone }),
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

  if (channel === 'bot') {
    // Nothing is issued here. The code is minted only when the bot asks for it
    // (issueWebRegisterCode), because otp_codes stores a hash — a code created
    // now could never be read back to show anyone.
    //
    // This channel exists because it is the only free one that still proves the
    // phone: Telegram vouches for the contact card the user shares, and the code
    // travels back to the browser through the person. Nothing depends on
    // Telegram delivering a deep-link payload, which is what broke the previous
    // handshake, and nothing depends on a paid gateway.
    return {
      sent: false,
      channel: 'bot',
      botUsername: config.telegram.botUsername,
      botLink: `https://t.me/${config.telegram.botUsername}`,
    };
  }

  if (channel === 'telegram') {
    // Same 6-digit code as the SMS path, delivered into the user's Telegram by
    // the Gateway (@VerificationCodes) instead of by SMS. They stay on the
    // website and type it in — nothing opens, nothing is polled.
    //
    // This replaced a handshake that sent the user to our bot via a t.me deep
    // link and waited for the bot to confirm. Telegram delivers the link's
    // ?start= payload only when the chat is new: for anyone who had already
    // opened the bot, it arrived as a bare "/start", the bot had nothing to
    // confirm, and the page waited forever.
    if (!isTelegramGatewayConfigured() && config.env === 'production') {
      throw new AppError(
        'Telegram orqali kod yuborish sozlanmagan, iltimos SMS orqali urinib ko\'ring.',
        503,
        'TELEGRAM_GATEWAY_NOT_CONFIGURED'
      );
    }

    // Deliver first; the previously issued code is only invalidated once this
    // succeeds, so a failure here leaves the user's existing code usable.
    const sent = await issueOtp(normPhone, 'register', ({ code, ttlMinutes }) =>
      sendTelegramCode(normPhone, code, ttlMinutes)
    );
    if (!sent.ok) {
      // The Gateway's own codes are operator language, not user language:
      // "BALANCE_NOT_ENOUGH" tells a shop owner nothing and reads like their
      // mistake. Keep the raw cause in the log for us, show them what to do.
      console.error(`[tg-gateway] send failed for ${normPhone}: ${sent.error}`);

      const unreachable =
        sent.error === 'PHONE_NUMBER_INVALID' || sent.error === 'USER_NOT_FOUND';
      throw new AppError(
        unreachable
          ? 'Bu raqamda Telegram topilmadi. SMS orqali urinib ko\'ring.'
          : 'Telegram orqali kod yuborish hozircha ishlamayapti. SMS orqali urinib ko\'ring.',
        unreachable ? 422 : 503,
        unreachable ? 'TELEGRAM_UNREACHABLE' : 'TELEGRAM_SEND_FAILED'
      );
    }
    return { sent: true, channel: 'telegram' };
  }

  const isSmsConfigured = Boolean(config.eskiz.email && config.eskiz.password);
  if (!isSmsConfigured && config.env === 'production') {
    throw new AppError(
      'SMS orqali yuborish hozircha ishlamayapti, iltimos Telegram orqali urinib koring.',
      503,
      'SMS_NOT_CONFIGURED'
    );
  }
  const sent = await issueOtp(normPhone, 'register', ({ code, ttlMinutes }) =>
    sendSms(
      normPhone,
      `TemirDaftar.uz: royxatdan otish uchun tasdiqlash kodi ${code}. Kod ${ttlMinutes} daqiqa amal qiladi. Bu kodni hech kimga bermang.`
    )
  );
  if (!sent.ok) {
    console.error(`[sms] register code failed for ${normPhone}: ${sent.error}`);
    throw new AppError(
      'SMS yuborib bo\'lmadi. Telegram orqali urinib ko\'ring.',
      502,
      'SMS_SEND_FAILED'
    );
  }
  return { sent: true, channel: 'sms' };
};

/**
 * Register a shop owner: creates user + shop + trial subscription + sms balance + reminder defaults.
 *
 * `skipOtp` is used only by the Telegram bot, where possession of the Telegram
 * session plus a shared contact already proves control of the number.
 */
export const registerShopOwner = async ({ phone, password, fullName, shopName, otp, skipOtp = false, telegramId = null }) => {
  const normPhone = normalizePhone(phone);
  if (!normPhone) throw new AppError('Telefon raqami noto\'g\'ri', 422, 'BAD_PHONE');

  await assertPhoneOwnership(normPhone, { otp, skipOtp });

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
export const registerPersonal = async ({ phone, password, fullName, otp, skipOtp = false, telegramId = null }) => {
  const normPhone = normalizePhone(phone);
  if (!normPhone) throw new AppError('Telefon raqami noto\'g\'ri', 422, 'BAD_PHONE');

  await assertPhoneOwnership(normPhone, { otp, skipOtp });

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
 * Sign in via a Telegram Mini App launch.
 *
 * Deliberately narrow: it authenticates an account that ALREADY linked its
 * Telegram — via the bot's contact-share flow, which is what actually proves
 * phone ownership — it does not register a new one. A Mini App launch carries
 * no phone number, only a Telegram user id, so it has no way to establish that
 * proof itself. Someone opening the Mini App who has never linked is told to
 * /start the bot in the same chat, where linking already works.
 */
export const loginTelegramWebApp = async (telegramId) => {
  const { rows } = await query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
  const user = rows[0];
  if (!user) {
    throw new AppError(
      'Bu Telegram akkaunt hech qanday hisobga ulanmagan. Botda /start yuboring.',
      404,
      'TELEGRAM_NOT_LINKED'
    );
  }
  if (!user.is_active) throw Unauthorized('Akkaunt bloklangan');
  return { user, tokens: issueTokens(user) };
};

/**
 * Set or change the account password.
 *
 * `skipCurrent` exists for accounts registered through the bot before it asked
 * for a password: their password_hash is a random string nobody has ever seen,
 * so demanding the current one would lock out exactly the people who need this.
 * It is granted only to our own bot (shared secret + the user's own token), on
 * the same reasoning the registration bypass uses — a Telegram session that has
 * shared its contact has already proven control of the number.
 */
export const changePassword = async ({ userId, currentPassword, newPassword, skipCurrent = false }) => {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [userId]);
  const user = rows[0];
  if (!user) throw new AppError('Foydalanuvchi topilmadi', 404, 'NOT_FOUND');
  if (!user.is_active) throw Unauthorized('Akkaunt bloklangan');

  if (!skipCurrent) {
    if (!currentPassword) {
      throw new AppError('Joriy parolni kiriting', 400, 'CURRENT_PASSWORD_REQUIRED');
    }
    const ok = user.password_hash
      ? await bcrypt.compare(currentPassword, user.password_hash)
      : false;
    if (!ok) throw Unauthorized('Joriy parol xato');
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  // password_changed_at is what /auth/refresh checks a token's `iat` against,
  // so this single write ends every session issued before now.
  const { rows: updated } = await query(
    `UPDATE users SET password_hash = $1, password_changed_at = now(), updated_at = now()
     WHERE id = $2 RETURNING *`,
    [passwordHash, userId]
  );

  // Including the caller's own session in that cull would be absurd — someone
  // setting a password from the bot would be logged straight out of it. Hand
  // back a fresh pair so the caller can replace what it holds.
  return { ok: true, tokens: issueTokens(updated[0]) };
};

/**
 * How long after asking on the website the bot will read a reset code out.
 * Long enough to open Telegram and share a contact, short enough that a stale
 * request cannot be picked up days later by whoever next opens the bot.
 */
const RESET_REQUEST_TTL_MINUTES = 15;

/**
 * STEP 1 of "forgot my password" — mark that a reset was asked for.
 *
 * Nothing is sent from here and no code exists yet: the only channel offered is
 * the bot, and the code is minted when the bot asks for it (issueWebResetCode),
 * exactly as the bot registration channel works. What this records is merely
 * permission for that to happen, scoped to one phone and 15 minutes.
 *
 * Unlike requestRegisterOtp — which must tell the caller a number is taken so
 * they log in instead — this responds identically whether or not the account
 * exists. Answering differently would turn a public, unauthenticated endpoint
 * into a way to test which phone numbers are registered.
 */
export const requestPasswordReset = async ({ phone }) => {
  const normPhone = normalizePhone(phone);
  if (!normPhone) throw new AppError('Telefon raqami noto\'g\'ri', 422, 'BAD_PHONE');

  const { rows } = await query(
    'SELECT id, is_active FROM users WHERE phone = $1',
    [normPhone]
  );
  const user = rows[0];
  // A blocked account is not recoverable by its owner: letting a reset through
  // would hand back a working login the admin has deliberately taken away.
  if (user && user.is_active) {
    await query(
      `INSERT INTO password_reset_requests (phone, expires_at)
       VALUES ($1, now() + ($2 || ' minutes')::interval)
       ON CONFLICT (phone) DO UPDATE
         SET requested_at = now(), expires_at = EXCLUDED.expires_at`,
      [normPhone, String(RESET_REQUEST_TTL_MINUTES)]
    );
  }

  return {
    sent: false,
    channel: 'bot',
    botUsername: config.telegram.botUsername,
    botLink: `https://t.me/${config.telegram.botUsername}`,
  };
};

/** True while a website reset request for this phone is still open. */
export const hasPendingPasswordReset = async (normPhone) => {
  const { rows } = await query(
    'SELECT 1 FROM password_reset_requests WHERE phone = $1 AND expires_at > now()',
    [normPhone]
  );
  return Boolean(rows[0]);
};

/**
 * Mint a password-reset code for someone who asked for one on the WEBSITE and
 * has just shared their contact card with our bot.
 *
 * Bot-only (shared secret, enforced in the controller), for the same reason
 * issueWebRegisterCode is: the response carries the plaintext code, so the
 * phone it is minted for has to come from Telegram rather than from a browser.
 *
 * This grants nothing the contact share did not already grant — directLinkByContact
 * hands that same person a full bot session on the account — but it is still
 * gated on a pending request, so nobody is shown a reset code they never asked
 * for.
 */
export const issueWebResetCode = async ({ phone, telegramId }) => {
  const normPhone = normalizePhone(phone);
  if (!normPhone) throw new AppError('Telefon raqami noto\'g\'ri', 422, 'BAD_PHONE');

  if (!(await hasPendingPasswordReset(normPhone))) {
    throw new AppError('Parolni tiklash so\'ralmagan', 409, 'RESET_NOT_REQUESTED');
  }

  const { rows } = await query('SELECT id, is_active FROM users WHERE phone = $1', [normPhone]);
  const user = rows[0];
  if (!user) throw new AppError('Foydalanuvchi topilmadi', 404, 'NOT_FOUND');
  if (!user.is_active) throw Unauthorized('Akkaunt bloklangan');

  const issued = await issueOtp(normPhone, 'password_reset');
  console.log(`[reset-code] issued for ${normPhone} via telegram ${telegramId}`);
  return { code: issued.code, ttlMinutes: issued.ttlMinutes };
};

/**
 * STEP 2 — set a new password with the code the bot read out.
 *
 * No tokens come back on purpose. password_changed_at is what /auth/refresh
 * measures a token's `iat` against, so this write ends every session the
 * account had — which is the point of a recovery flow: whoever prompted it may
 * be locked out precisely because someone else is logged in. The user signs in
 * again with the password they just set.
 */
export const resetPassword = async ({ phone, otp, newPassword }) => {
  const normPhone = normalizePhone(phone);
  if (!normPhone) throw new AppError('Telefon raqami noto\'g\'ri', 422, 'BAD_PHONE');

  // throws on expired / wrong / too many attempts, and consumes the code
  await verifyOtp(normPhone, otp, 'password_reset');

  const { rows } = await query('SELECT * FROM users WHERE phone = $1', [normPhone]);
  const user = rows[0];
  if (!user) throw new AppError('Foydalanuvchi topilmadi', 404, 'NOT_FOUND');
  if (!user.is_active) throw Unauthorized('Akkaunt bloklangan');

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await query(
    `UPDATE users SET password_hash = $1, password_changed_at = now(), updated_at = now()
     WHERE id = $2`,
    [passwordHash, user.id]
  );

  // The request is spent; leaving it open would let the bot mint another code
  // for the rest of the window.
  await query('DELETE FROM password_reset_requests WHERE phone = $1', [normPhone]);

  return { ok: true };
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

  const sent = await issueOtp(normPhone, 'telegram_link', ({ code, ttlMinutes }) =>
    sendSms(
      normPhone,
      `TemirDaftar.uz: Telegram botni ulash uchun tasdiqlash kodi ${code}. Kod ${ttlMinutes} daqiqa amal qiladi. Bu kodni hech kimga bermang.`
    )
  );
  // Previously this claimed { sent: true } no matter what the provider did, so
  // a failed send left the user waiting for a code that was never on its way.
  if (!sent.ok) {
    console.error(`[sms] telegram-link code failed for ${normPhone}: ${sent.error}`);
    throw new AppError('SMS yuborib bo\'lmadi. Keyinroq urinib ko\'ring.', 502, 'SMS_SEND_FAILED');
  }

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

/**
 * Proof of phone ownership before an account (and password) is created: the
 * 6-digit code we sent (by SMS or into Telegram via the Gateway), or the bot's
 * own shared secret.
 */
const assertPhoneOwnership = async (normPhone, { otp, skipOtp }) => {
  if (skipOtp) return;
  await verifyOtp(normPhone, otp, 'register');
};

/**
 * Mint a registration code for someone who is signing up on the WEBSITE and has
 * just proved their number by sharing a contact card with our bot.
 *
 * Called by the bot only (shared secret, enforced in the controller). The phone
 * therefore comes from Telegram, not from a browser — which is exactly the
 * property that makes handing back a plaintext code safe here: the only person
 * who can trigger it for a number is whoever controls that Telegram account and
 * shared that contact.
 *
 * Refuses a number that already has an account: that person needs to log in,
 * and minting a registration code for them would be a way to probe which
 * numbers exist.
 */
export const issueWebRegisterCode = async ({ phone, telegramId }) => {
  const normPhone = normalizePhone(phone);
  if (!normPhone) throw new AppError('Telefon raqami noto\'g\'ri', 422, 'BAD_PHONE');

  const { rows } = await query('SELECT id FROM users WHERE phone = $1', [normPhone]);
  if (rows[0]) {
    throw new AppError(
      'Bu raqam allaqachon ro\'yxatdan o\'tgan.',
      409,
      'PHONE_TAKEN'
    );
  }

  const issued = await issueOtp(normPhone, 'register');
  console.log(`[web-code] issued for ${normPhone} via telegram ${telegramId}`);
  return { code: issued.code, ttlMinutes: issued.ttlMinutes };
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
    // Lets the bot know to follow up with a reset code instead of asking for
    // one on every contact share (see issueWebResetCode).
    resetPending: await hasPendingPasswordReset(normPhone),
    user: { id: user.id, role: user.role, phone: user.phone, telegram_id: telegramId },
    tokens: issueTokens(user),
  };
};


