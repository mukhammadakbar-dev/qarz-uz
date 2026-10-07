import { describe, expect, it } from 'vitest';
import { signInitData } from '../../../test/init-data.js';
import { UnauthorizedError } from '../../errors/index.js';
import { verifyInitData } from './init-data.js';
import { issueSessionToken, verifySessionToken } from './session.js';

const BOT_TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const NOW = 1_800_000_000;

const user = { id: 840369610, first_name: 'Akbar', username: 'akbar', language_code: 'uz' };
const fields = (over: Record<string, string> = {}) => ({
  auth_date: String(NOW - 10),
  query_id: 'AAH_test',
  user: JSON.stringify(user),
  ...over,
});
const opts = { botToken: BOT_TOKEN, maxAgeSeconds: 3600, nowSeconds: NOW };
const rejects = (initData: string, o = opts) =>
  expect(() => verifyInitData(initData, o)).toThrow(UnauthorizedError);

describe('verifyInitData', () => {
  it('to‘g‘ri imzolangan initData qabul qilinadi', () => {
    const r = verifyInitData(signInitData(fields()), opts);
    expect(r.user).toMatchObject({ id: 840369610, first_name: 'Akbar', username: 'akbar' });
    expect(r.authDate).toBe(NOW - 10);
  });

  it('har qanday maydon o‘zgartirilsa rad etiladi', () => {
    const good = new URLSearchParams(signInitData(fields()));
    const tampered = new URLSearchParams(good);
    tampered.set('user', JSON.stringify({ ...user, id: 1 }));
    rejects(tampered.toString());
    const extra = new URLSearchParams(good);
    extra.set('start_param', 'x');
    rejects(extra.toString());
  });

  it('hash noto‘g‘ri, yo‘q yoki takroriy bo‘lsa rad etiladi', () => {
    rejects(signInitData(fields(), BOT_TOKEN, (h) => h.replace(/^./, h[0] === 'a' ? 'b' : 'a')));
    rejects(signInitData(fields(), BOT_TOKEN, () => 'abc'));
    rejects(new URLSearchParams(fields()).toString());
    rejects(`${signInitData(fields())}&hash=${'0'.repeat(64)}`);
  });

  it('boshqa bot tokeni bilan imzolangan bo‘lsa rad etiladi', () => {
    rejects(signInitData(fields(), '999:OTHER_TOKEN_xxxxxxxxxxxxxxxxxxxx'));
  });

  it('muddati o‘tgan va kelajakdagi auth_date rad etiladi', () => {
    rejects(signInitData(fields({ auth_date: String(NOW - 3601) })));
    rejects(signInitData(fields({ auth_date: String(NOW + 600) })));
    expect(() =>
      verifyInitData(signInitData(fields({ auth_date: String(NOW - 3600) })), opts),
    ).not.toThrow();
  });

  it('auth_date yoki user yaroqsiz bo‘lsa rad etiladi', () => {
    rejects(signInitData(fields({ auth_date: 'abc' })));
    rejects(signInitData(fields({ user: 'not-json' })));
    rejects(signInitData(fields({ user: JSON.stringify({ first_name: 'x' }) })));
    rejects(signInitData(fields({ user: JSON.stringify({ ...user, is_bot: true }) })));
    rejects(signInitData(fields({ user: JSON.stringify({ ...user, id: -5 }) })));
  });

  it('bo‘sh va juda uzun kiritma rad etiladi', () => {
    rejects('');
    rejects('a='.padEnd(9000, 'x'));
  });
});

describe('session token', () => {
  const o = { secret: 'k'.repeat(32), ttlSeconds: 3600, nowSeconds: NOW };

  it('chiqarilgan token tekshiruvdan o‘tadi va user_id ni qaytaradi', () => {
    const { token, expiresAt } = issueSessionToken('user-1', o);
    expect(expiresAt.getTime()).toBe((NOW + 3600) * 1000);
    expect(verifySessionToken(token, { secret: o.secret, nowSeconds: NOW + 10 })).toBe('user-1');
  });

  it('muddati o‘tgan token rad etiladi', () => {
    const { token } = issueSessionToken('user-1', o);
    expect(() => verifySessionToken(token, { secret: o.secret, nowSeconds: NOW + 3600 })).toThrow(
      UnauthorizedError,
    );
  });

  it('boshqa secret yoki o‘zgartirilgan payload/imzo rad etiladi', () => {
    const { token } = issueSessionToken('user-1', o);
    const [v, p, s] = token.split('.') as [string, string, string];
    const forged = Buffer.from(
      JSON.stringify({ typ: 'miniapp-session', sub: 'admin', iat: NOW, exp: NOW + 9999 }),
    ).toString('base64url');
    for (const bad of [
      `${v}.${forged}.${s}`,
      `${v}.${p}.${s.slice(0, -2)}AA`,
      `${v}.${p}`,
      `v2.${p}.${s}`,
      '',
      'a.b.c',
    ]) {
      expect(() => verifySessionToken(bad, { secret: o.secret, nowSeconds: NOW })).toThrow(
        UnauthorizedError,
      );
    }
    expect(() => verifySessionToken(token, { secret: 'x'.repeat(32), nowSeconds: NOW })).toThrow(
      UnauthorizedError,
    );
  });
});
