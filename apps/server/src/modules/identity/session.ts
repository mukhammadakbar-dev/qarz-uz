import { createHmac, timingSafeEqual } from 'node:crypto';
import { UnauthorizedError } from '../../errors/index.js';

/**
 * Mini App sessiya tokeni: `v1.<payload>.<imzo>` (base64url, HMAC-SHA256, SESSION_SECRET).
 * Token FAQAT user_id ni tashiydi. Biznes va rol har so'rovda DB'dan o'qiladi, shuning uchun
 * revoke darhol kuchga kiradi (ADR-0006 §1, §3).
 */

const VERSION = 'v1';
const TYPE = 'miniapp-session';

export interface SessionOptions {
  readonly secret: string;
  readonly ttlSeconds: number;
  readonly nowSeconds?: number;
}

interface Payload {
  typ: typeof TYPE;
  sub: string;
  iat: number;
  exp: number;
}

const b64 = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');
const sign = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest();

export function issueSessionToken(
  userId: string,
  options: SessionOptions,
): { token: string; expiresAt: Date } {
  const iat = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const exp = iat + options.ttlSeconds;
  const payload = b64(JSON.stringify({ typ: TYPE, sub: userId, iat, exp } satisfies Payload));
  const body = `${VERSION}.${payload}`;
  return { token: `${body}.${b64(sign(options.secret, body))}`, expiresAt: new Date(exp * 1000) };
}

/** Yaroqli token uchun user_id ni qaytaradi, aks holda UnauthorizedError. */
export function verifySessionToken(
  token: string,
  options: Omit<SessionOptions, 'ttlSeconds'>,
): string {
  const fail = () => new UnauthorizedError('Sessiya yaroqsiz, ilovani qayta oching');
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) throw fail();
  const [, payloadPart, sigPart] = parts as [string, string, string];

  const expected = sign(options.secret, `${VERSION}.${payloadPart}`);
  const actual = Buffer.from(sigPart, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw fail();

  let payload: Partial<Payload>;
  try {
    payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  } catch {
    throw fail();
  }
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (
    payload.typ !== TYPE ||
    typeof payload.sub !== 'string' ||
    typeof payload.exp !== 'number' ||
    payload.exp <= now
  ) {
    throw fail();
  }
  return payload.sub;
}
