import crypto from 'crypto';
import { config } from '../config/index.js';

/**
 * Verify Telegram Mini App `initData` and return the launching user, or null.
 *
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * initData is signed with a key derived from the bot token, so THIS signature
 * is the entire authentication boundary for the endpoint that accepts it —
 * unlike the bot's own admin routes, there is no separate shared secret to
 * check. Anyone who can produce a valid signature necessarily holds the bot
 * token, which only Telegram and we do.
 *
 * Never throws: every caller treats "invalid" and "unparseable" identically
 * (refuse), so collapsing every failure mode to a null return keeps the call
 * site to one check instead of a try/catch around a validator.
 */

// A signed payload from Telegram never expires on its own, so without an age
// check a launch captured once (a saved URL, a screenshot of a QR code) would
// authenticate forever. This mirrors the fail-closed instinct behind every
// other expiry in this codebase (OTP codes, verify tokens).
const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;

export const verifyTelegramWebAppData = (initData) => {
  if (!config.telegram.botToken) return null; // unconfigured bot signs nothing
  if (typeof initData !== 'string' || !initData) return null;

  let params;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }

  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  // Signature covers every remaining field, sorted by key and joined with \n —
  // Telegram's exact recipe. Any field this endpoint does not otherwise use
  // still has to survive unmodified into the check string, or a real launch
  // would fail verification.
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(config.telegram.botToken)
    .digest();
  const expected = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(hash, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > MAX_AUTH_AGE_SECONDS) return null;

  let user;
  try {
    user = JSON.parse(params.get('user') || '');
  } catch {
    return null;
  }
  if (!user?.id) return null;

  return { id: user.id, firstName: user.first_name, username: user.username };
};
