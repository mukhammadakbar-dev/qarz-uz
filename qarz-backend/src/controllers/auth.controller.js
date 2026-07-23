import { z } from 'zod';
import { asyncHandler } from '../utils/errors.js';
import {
  registerShopOwner,
  registerPersonal,
  login,
  requestTelegramLink,
  confirmTelegramLink,
} from '../services/auth.service.js';
import { verifyRefreshToken, signAccessToken, signRefreshToken } from '../utils/tokens.js';
import { Unauthorized } from '../utils/errors.js';

export const schemas = {
  registerShop: z.object({
    phone: z.string().min(7),
    password: z.string().min(6),
    fullName: z.string().min(1).optional(),
    shopName: z.string().min(1),
  }),
  registerPersonal: z.object({
    phone: z.string().min(7),
    password: z.string().min(6),
    fullName: z.string().min(1).optional(),
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
    otp: z.string().regex(/^\d{6}$/, 'Kod 6 xonali bo\'lishi kerak'),
  }),
  refresh: z.object({ refreshToken: z.string().min(10) }),
};

export const registerShopCtrl = asyncHandler(async (req, res) => {
  const result = await registerShopOwner(req.body);
  res.status(201).json({
    user: { id: result.user.id, role: result.user.role, phone: result.user.phone },
    shop: { id: result.shop.id, name: result.shop.name },
    ...result.tokens,
  });
});

export const registerPersonalCtrl = asyncHandler(async (req, res) => {
  const result = await registerPersonal(req.body);
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
