import crypto from 'crypto';
import { config } from '../config/index.js';
import { Forbidden } from '../utils/errors.js';

/**
 * Does this request carry our own Telegram bot's shared secret?
 *
 * Decided purely from the x-bot-secret header — never from the request body,
 * which any client can set itself. An unset secret means "no bot is trusted",
 * so a missing configuration fails closed rather than granting the privilege
 * to everyone.
 */
export const hasBotSecret = (req) => {
  const secret = config.botSharedSecret;
  if (!secret) return false;

  const provided = req.get('x-bot-secret');
  if (typeof provided !== 'string' || provided.length === 0) return false;

  // Constant-time compare, so the secret cannot be recovered byte-by-byte by
  // timing responses. timingSafeEqual requires equal lengths, hence the guard —
  // length alone leaks nothing an attacker cannot measure from the header size.
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(secret, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/**
 * Gate a route to our own bot. Unlike `authenticate`, this proves *which
 * program* is calling, not which user — so it belongs only on endpoints the
 * bot needs to act across users (its session store), never on user data.
 */
export const requireBotSecret = (req, _res, next) => {
  if (!hasBotSecret(req)) return next(Forbidden('Bot autentifikatsiyasi talab qilinadi'));
  next();
};
