import { z } from 'zod';
import { asyncHandler } from '../utils/errors.js';
import {
  registerShopOwner,
  registerPersonal,
  requestRegisterOtp,
  login,
  requestTelegramLink,
  confirmTelegramLink,
  getVerifyStatus,
  confirmVerifyToken,
  directLinkByContact,
} from '../services/auth.service.js';
import { verifyRefreshToken, signAccessToken, signRefreshToken } from '../utils/tokens.js';
import { Unauthorized } from '../utils/errors.js';
import { query } from '../db/pool.js';
import { hasBotSecret } from '../middleware/botAuth.js';

const otpField = z.string().regex(/^\d{6}$/, 'Kod 6 xonali bo\'lishi kerak');

// 32 random bytes, hex-encoded, issued by the Telegram registration handshake
const verifyTokenField = z.string().regex(/^[a-f0-9]{64}$/, 'Token yaroqsiz');
// Telegram user ids are positive and comfortably inside the safe-integer range
const telegramIdField = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const schemas = {
  requestRegisterOtp: z.object({
    phone: z.string().min(7),
    // Was missing, so zod silently stripped it and every request fell through
    // to the SMS branch — the "Telegram orqali kod olish" button never worked.
    channel: z.enum(['sms', 'telegram']).optional(),
  }),
  registerShop: z.object({
    phone: z.string().min(7),
    password: z.string().min(6),
    fullName: z.string().min(1).optional(),
    shopName: z.string().min(1),
    // one of these proves phone ownership, unless the trusted bot secret is
    // presented (see isTrustedBot)
    otp: otpField.optional(),
    verifyToken: verifyTokenField.optional(),
  }),
  registerPersonal: z.object({
    phone: z.string().min(7),
    password: z.string().min(6),
    fullName: z.string().min(1).optional(),
    otp: otpField.optional(),
    verifyToken: verifyTokenField.optional(),
  }),
  login: z.object({
    phone: z.string().min(7),
    password: z.string().min(6),
  }),
  requestTelegramLink: z.object({
    phone: z.string().min(7),
  }),
  confirmTelegramLink: z.object({
    phone: z.string().min(7),
    telegramId: telegramIdField,
    otp: otpField,
  }),
  confirmVerifyToken: z.object({
    token: verifyTokenField,
    telegramId: telegramIdField,
    // proven by the bot from a shared contact card, not typed by the user
    phone: z.string().min(7),
  }),
  directLink: z.object({
    phone: z.string().min(7),
    telegramId: telegramIdField,
  }),
  verifyStatusParam: z.object({ token: verifyTokenField }),
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
  const { rows } = await query('SELECT id, role, is_active FROM users WHERE id = $1', [
    payload.sub,
  ]);
  const user = rows[0];
  if (!user || !user.is_active) throw Unauthorized('Foydalanuvchi faol emas');

  res.json({
    accessToken: signAccessToken({ sub: user.id, role: user.role }),
    refreshToken: signRefreshToken({ sub: user.id, role: user.role }),
  });
});

export const getVerifyStatusCtrl = asyncHandler(async (req, res) => {
  const result = await getVerifyStatus(req.params.token);
  res.json(result);
});

/**
 * Bot-only: completes the Telegram registration handshake. Requires the shared
 * secret because the caller asserts a phone number proven by a Telegram contact
 * card — an assertion only our own bot is in a position to make truthfully.
 */
export const confirmVerifyTokenCtrl = asyncHandler(async (req, res) => {
  if (!isTrustedBot(req)) throw Unauthorized('Faqat bot uchun');
  const result = await confirmVerifyToken(
    req.body.token,
    req.body.telegramId,
    req.body.phone
  );
  res.json(result);
});

export const directLinkByContactCtrl = asyncHandler(async (req, res) => {
  if (!isTrustedBot(req)) throw Unauthorized('Faqat bot uchun');
  const result = await directLinkByContact(req.body);
  res.json(result);
});


