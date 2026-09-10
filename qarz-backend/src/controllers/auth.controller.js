import { z } from 'zod';
import { asyncHandler } from '../utils/errors.js';
import {
  registerShopOwner,
  registerPersonal,
  requestRegisterOtp,
  login,
  requestTelegramLink,
  confirmTelegramLink,
  directLinkByContact,
  issueWebRegisterCode,
  loginTelegramWebApp,
  changePassword,
  requestPasswordReset,
  issueWebResetCode,
  resetPassword,
} from '../services/auth.service.js';
import { verifyRefreshToken, signAccessToken, signRefreshToken } from '../utils/tokens.js';
import { Unauthorized } from '../utils/errors.js';
import { query } from '../db/pool.js';
import { hasBotSecret } from '../middleware/botAuth.js';
import { verifyTelegramWebAppData } from '../utils/telegramAuth.js';

const otpField = z.string().regex(/^\d{6}$/, 'Kod 6 xonali bo\'lishi kerak');

// Telegram user ids are positive and comfortably inside the safe-integer range
const telegramIdField = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const schemas = {
  requestRegisterOtp: z.object({
    phone: z.string().min(7),
    // Was missing, so zod silently stripped it and every request fell through
    // to the SMS branch — the "Telegram orqali kod olish" button never worked.
    channel: z.enum(['sms', 'telegram', 'bot']).optional(),
  }),
  registerShop: z.object({
    phone: z.string().min(7),
    password: z.string().min(6),
    fullName: z.string().min(1).optional(),
    shopName: z.string().min(1),
    // proves phone ownership, unless the trusted bot secret is presented
    // (see isTrustedBot)
    otp: otpField.optional(),
  }),
  registerPersonal: z.object({
    phone: z.string().min(7),
    password: z.string().min(6),
    fullName: z.string().min(1).optional(),
    otp: otpField.optional(),
  }),
  login: z.object({
    phone: z.string().min(7),
    password: z.string().min(6),
  }),
  changePassword: z.object({
    // Optional because the bot may omit it — see changePassword's skipCurrent.
    currentPassword: z.string().min(1).optional(),
    newPassword: z.string().min(6, 'Parol kamida 6 belgi bo\'lishi kerak'),
  }),
  requestPasswordReset: z.object({
    phone: z.string().min(7),
  }),
  resetPassword: z.object({
    phone: z.string().min(7),
    otp: otpField,
    newPassword: z.string().min(6, 'Parol kamida 6 belgi bo\'lishi kerak'),
  }),
  requestTelegramLink: z.object({
    phone: z.string().min(7),
  }),
  confirmTelegramLink: z.object({
    phone: z.string().min(7),
    telegramId: telegramIdField,
    otp: otpField,
  }),
  directLink: z.object({
    phone: z.string().min(7),
    telegramId: telegramIdField,
  }),
  telegramWebApp: z.object({
    // Opaque to us at this layer: verifyTelegramWebAppData is what actually
    // parses and authenticates it. Keeping validation there, not in a regex
    // here, means there is exactly one place that has to agree with Telegram's
    // signing recipe.
    initData: z.string().min(1),
  }),
  webRegisterCode: z.object({
    // Proven by the bot from a shared contact card, never typed by a browser.
    phone: z.string().min(7),
    telegramId: telegramIdField,
  }),
  refresh: z.object({ refreshToken: z.string().min(10) }),
};

/**
 * The Telegram bot may skip the registration OTP, because a shared contact in
 * an authenticated Telegram session already proves control of the number.
 *
 * The check itself lives in middleware/botAuth.js so the bot session store and
 * these registration routes cannot drift apart on how the secret is compared.
 */
const isTrustedBot = hasBotSecret;

export const requestRegisterOtpCtrl = asyncHandler(async (req, res) => {
  const result = await requestRegisterOtp(req.body);
  res.json(result);
});

export const registerShopCtrl = asyncHandler(async (req, res) => {
  const result = await registerShopOwner({ ...req.body, skipOtp: isTrustedBot(req) });
  res.status(201).json({
    user: { id: result.user.id, role: result.user.role, phone: result.user.phone },
    shop: { id: result.shop.id, name: result.shop.name },
    ...result.tokens,
  });
});

export const registerPersonalCtrl = asyncHandler(async (req, res) => {
  const result = await registerPersonal({ ...req.body, skipOtp: isTrustedBot(req) });
  res.status(201).json({
    user: { id: result.user.id, role: result.user.role, phone: result.user.phone },
    ...result.tokens,
  });
});

export const loginCtrl = asyncHandler(async (req, res) => {
  const result = await login(req.body);
  res.json({
    user: { id: result.user.id, role: result.user.role, phone: result.user.phone },
    ...result.tokens,
  });
});

/**
 * Set or change the caller's own password.
 *
 * The bot may skip the current-password check: accounts it registered before it
 * started asking for one hold a random hash nobody knows, so this is how their
 * owner gets a password they can actually type on the web. Everyone else proves
 * they know the old one.
 */
export const changePasswordCtrl = asyncHandler(async (req, res) => {
  const result = await changePassword({
    userId: req.user.id,
    currentPassword: req.body.currentPassword,
    newPassword: req.body.newPassword,
    skipCurrent: isTrustedBot(req),
  });
  // The caller's own tokens were just invalidated along with everyone else's;
  // these replace them so the session it is acting from survives the change.
  res.json({ ok: result.ok, ...result.tokens });
});

/**
 * Forgot-password step 1. Public and deliberately incurious: it answers the
 * same way for a registered number and an unknown one (see requestPasswordReset).
 */
export const requestPasswordResetCtrl = asyncHandler(async (req, res) => {
  const result = await requestPasswordReset(req.body);
  res.json(result);
});

/**
 * Forgot-password step 2 — the code from the bot plus the new password.
 * Returns no tokens: every session, including any attacker's, is ended by the
 * change and the user signs in again.
 */
export const resetPasswordCtrl = asyncHandler(async (req, res) => {
  const result = await resetPassword(req.body);
  res.json(result);
});

/**
 * Bot-only (same reasoning as webRegisterCodeCtrl: the plaintext code is in the
 * response, so the phone must come from Telegram rather than a browser).
 */
export const webResetCodeCtrl = asyncHandler(async (req, res) => {
  if (!isTrustedBot(req)) throw Unauthorized('Faqat bot uchun');
  const result = await issueWebResetCode(req.body);
  res.json(result);
});

export const requestTelegramLinkCtrl = asyncHandler(async (req, res) => {
  const result = await requestTelegramLink(req.body);
  res.json(result);
});

export const confirmTelegramLinkCtrl = asyncHandler(async (req, res) => {
  const result = await confirmTelegramLink(req.body);
  res.json(result);
});

export const refreshCtrl = asyncHandler(async (req, res) => {
  let payload;
  try {
    payload = verifyRefreshToken(req.body.refreshToken);
  } catch {
    throw Unauthorized('Refresh token yaroqsiz');
  }

  // Re-read the account instead of trusting the token's copy of the role: a
  // 30-day refresh token would otherwise keep minting access tokens for an
  // account that has since been blocked, deleted, or had its role changed.
  const { rows } = await query(
    'SELECT id, role, is_active, password_changed_at FROM users WHERE id = $1',
    [payload.sub]
  );
  const user = rows[0];
  if (!user || !user.is_active) throw Unauthorized('Foydalanuvchi faol emas');

  // A refresh token lives 30 days and there is no blocklist, so without this a
  // password change left every previously issued session working — including
  // the attacker's, in the one case where changing the password is urgent.
  //
  // The two sides of this comparison come from two clocks: `iat` is stamped by
  // this process, `password_changed_at` by Postgres. They agree on one host and
  // can drift by a second or two across hosts, and when the DB runs ahead the
  // token pair changePassword just handed back is rejected on its first use —
  // logging someone out of the bot the instant they set a password. The grace
  // absorbs that; two seconds of leeway is nothing next to a 30-day token.
  const CLOCK_SKEW_GRACE_SEC = 2;
  if (user.password_changed_at) {
    const changedAtSec = Math.floor(new Date(user.password_changed_at).getTime() / 1000);
    if (payload.iat + CLOCK_SKEW_GRACE_SEC < changedAtSec) {
      throw Unauthorized('Parol o\'zgartirilgan — qaytadan kiring');
    }
  }

  res.json({
    accessToken: signAccessToken({ sub: user.id, role: user.role, phone: user.phone }),
    refreshToken: signRefreshToken({ sub: user.id, role: user.role }),
  });
});

/**
 * Bot-only: hand the bot a registration code to read out to someone signing up
 * on the website. The shared secret is the whole gate — the plaintext code is
 * returned in the response, so an unauthenticated caller reaching this would be
 * able to mint a code for any number they liked.
 */
export const webRegisterCodeCtrl = asyncHandler(async (req, res) => {
  if (!isTrustedBot(req)) throw Unauthorized('Faqat bot uchun');
  const result = await issueWebRegisterCode(req.body);
  res.json(result);
});

/**
 * POST /api/auth/telegram/webapp — sign in from inside the Telegram Mini App.
 *
 * Public and unauthenticated by design: the initData signature itself is the
 * proof of identity (see verifyTelegramWebAppData), the same way a Click
 * webhook is trusted on its signature rather than a bearer token.
 */
export const loginTelegramWebAppCtrl = asyncHandler(async (req, res) => {
  const launch = verifyTelegramWebAppData(req.body.initData);
  if (!launch) throw Unauthorized('Telegram ma\'lumotlari yaroqsiz');

  const result = await loginTelegramWebApp(launch.id);
  res.json({
    user: { id: result.user.id, role: result.user.role, phone: result.user.phone },
    ...result.tokens,
  });
});

export const directLinkByContactCtrl = asyncHandler(async (req, res) => {
  if (!isTrustedBot(req)) throw Unauthorized('Faqat bot uchun');
  const result = await directLinkByContact(req.body);
  res.json(result);
});


