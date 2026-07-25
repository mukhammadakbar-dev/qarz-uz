import { z } from 'zod';
import { asyncHandler } from '../utils/errors.js';
import {
  registerShopOwner,
  registerPersonal,
  requestRegisterOtp,
  login,
  requestTelegramLink,
  confirmTelegramLink,
} from '../services/auth.service.js';
import { verifyRefreshToken, signAccessToken, signRefreshToken } from '../utils/tokens.js';
import { Unauthorized } from '../utils/errors.js';
import { config } from '../config/index.js';

const otpField = z.string().regex(/^\d{6}$/, 'Kod 6 xonali bo\'lishi kerak');

export const schemas = {
  requestRegisterOtp: z.object({
    phone: z.string().min(7),
  }),
  registerShop: z.object({
    phone: z.string().min(7),
    password: z.string().min(6),
    fullName: z.string().min(1).optional(),
    shopName: z.string().min(1),
    otp: otpField.optional(), // required unless the trusted bot secret is presented
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
  requestTelegramLink: z.object({
    phone: z.string().min(7),
  }),
  confirmTelegramLink: z.object({
    phone: z.string().min(7),
    telegramId: z.number().int(),
    otp: otpField,
  }),
  refresh: z.object({ refreshToken: z.string().min(10) }),
};

/**
 * The Telegram bot may skip the registration OTP, because a shared contact in
 * an authenticated Telegram session already proves control of the number.
 *
 * This is decided from a server-side shared secret header — never from the
 * request body, which a client could simply set itself.
 */
const isTrustedBot = (req) => {
  const secret = config.botSharedSecret;
  if (!secret) return false;
  const provided = req.get('x-bot-secret');
  return typeof provided === 'string' && provided.length > 0 && provided === secret;
};

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
  res.json({
    accessToken: signAccessToken({ sub: payload.sub, role: payload.role }),
    refreshToken: signRefreshToken({ sub: payload.sub, role: payload.role }),
  });
});
