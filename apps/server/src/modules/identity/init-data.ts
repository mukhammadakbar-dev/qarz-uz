import { createHmac, timingSafeEqual } from 'node:crypto';
import { UnauthorizedError } from '../../errors/index.js';
import type { TelegramProfile } from './users.js';

/**
 * Telegram Mini App `initData` ni tekshiradi (ADR-0006 §1).
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *   secret = HMAC_SHA256(key = "WebAppData", message = bot_token)
 *   hash   = HMAC_SHA256(key = secret, message = data_check_string)
 * data_check_string: `hash` dan boshqa barcha maydonlar `kalit=qiymat`, kalit bo'yicha
 * saralangan va `\n` bilan birlashtirilgan.
 */

export interface InitDataOptions {
  readonly botToken: string;
  readonly maxAgeSeconds: number;
  /** Test uchun: joriy vaqt (sekund). */
  readonly nowSeconds?: number;
}

export interface VerifiedInitData {
  readonly user: TelegramProfile;
  readonly authDate: number;
}

const CLOCK_SKEW_SECONDS = 60;
const INVALID = 'Telegram ma’lumotlari yaroqsiz';

export function verifyInitData(initData: string, options: InitDataOptions): VerifiedInitData {
  if (typeof initData !== 'string' || initData.length === 0 || initData.length > 8192) {
    throw new UnauthorizedError(INVALID);
  }
  const params = new URLSearchParams(initData);
  const hashes = params.getAll('hash');
  if (hashes.length !== 1 || !/^[0-9a-f]{64}$/.test(hashes[0]!))
    throw new UnauthorizedError(INVALID);
  const received = Buffer.from(hashes[0]!, 'hex');

  const pairs: string[] = [];
  const seen = new Set<string>();
  for (const [key, value] of params) {
    if (key === 'hash') continue;
    if (seen.has(key)) throw new UnauthorizedError(INVALID); // takroriy maydon — shubhali
    seen.add(key);
    pairs.push(`${key}=${value}`);
  }
  const dataCheckString = pairs.toSorted().join('\n');

  const secret = createHmac('sha256', 'WebAppData').update(options.botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest();
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new UnauthorizedError(INVALID);
  }

  const authDate = Number(params.get('auth_date'));
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(authDate) || authDate <= 0) throw new UnauthorizedError(INVALID);
  if (authDate > now + CLOCK_SKEW_SECONDS) throw new UnauthorizedError(INVALID);
  if (now - authDate > options.maxAgeSeconds) {
    throw new UnauthorizedError('Sessiya eskirgan, ilovani qayta oching');
  }

  let user: unknown;
  try {
    user = JSON.parse(params.get('user') ?? '');
  } catch {
    throw new UnauthorizedError(INVALID);
  }
  const u = user as Partial<{
    id: number;
    username: string;
    first_name: string;
    last_name: string;
    is_bot: boolean;
  }>;
  if (!u || !Number.isSafeInteger(u.id) || (u.id as number) <= 0 || u.is_bot === true) {
    throw new UnauthorizedError(INVALID);
  }
  return {
    authDate,
    user: {
      id: u.id as number,
      username: typeof u.username === 'string' ? u.username : undefined,
      first_name: typeof u.first_name === 'string' ? u.first_name : undefined,
      last_name: typeof u.last_name === 'string' ? u.last_name : undefined,
    },
  };
}
