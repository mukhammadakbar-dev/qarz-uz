import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config/index.js';

export const signAccessToken = (payload) =>
  jwt.sign(payload, config.jwt.accessSecret, { expiresIn: config.jwt.accessTtl });

export const signRefreshToken = (payload) =>
  jwt.sign(payload, config.jwt.refreshSecret, { expiresIn: config.jwt.refreshTtl });

export const verifyAccessToken = (token) =>
  jwt.verify(token, config.jwt.accessSecret);

export const verifyRefreshToken = (token) =>
  jwt.verify(token, config.jwt.refreshSecret);

/**
 * One-time, unguessable payment link token bound to a single debt.
 * Uses random hash + HMAC signature so the server can verify integrity.
 */
export const generatePaymentToken = (debtId) => {
  const random = crypto.randomBytes(24).toString('hex');
  const raw = `${debtId}.${random}`;
  const sig = crypto
    .createHmac('sha256', config.jwt.paymentLinkSecret)
    .update(raw)
    .digest('hex')
    .slice(0, 32);
  return `${random}.${sig}`;
};
