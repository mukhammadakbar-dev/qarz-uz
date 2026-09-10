// Forgot-password recovery: /password/request-reset → the bot reads a code out
// (/telegram/web-reset-code) → /password/reset sets the new one.
//
// The delicate parts, and why each is asserted below:
//   * step 1 must answer identically for a registered and an unknown number, or
//     a public endpoint becomes a way to test which phones have accounts;
//   * the code is minted only for someone who ASKED for a reset, so nobody who
//     merely opened the bot is shown one;
//   * that minting is bot-only — the response carries the plaintext code;
//   * the reset ends every existing session (password_changed_at), which is the
//     whole point when the reason for recovering is that someone else is in.
import { createServer } from 'http';
import { newDb } from 'pg-mem';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

const mem = newDb();
mem.public.registerFunction({ name: 'now', returns: 'timestamptz', implementation: () => new Date() });
mem.public.registerFunction({
  name: 'gen_random_uuid', returns: 'text', implementation: () => randomUUID(), impure: true,
});

const knownHash = bcrypt.hashSync('eskiparol', 10);

mem.public.none(`
  CREATE TABLE users (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    role TEXT NOT NULL,
    phone TEXT UNIQUE,
    password_hash TEXT,
    password_changed_at TIMESTAMPTZ,
    full_name TEXT,
    telegram_id BIGINT,
    parent_shop_id TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE otp_codes (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    phone TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'telegram_link',
    attempts INTEGER NOT NULL DEFAULT 0,
    consumed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE password_reset_requests (
    phone TEXT PRIMARY KEY,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
  );
  INSERT INTO users (id, role, phone, password_hash) VALUES ('u-1', 'shop_owner', '+998901111111', '${knownHash}');
  INSERT INTO users (id, role, phone, password_hash, is_active) VALUES ('u-off', 'personal', '+998903333333', '${knownHash}', FALSE);
`);

const { Pool } = mem.adapters.createPg();
const memPool = new Pool();
const { default: pgMod } = await import('pg');
pgMod.Pool.prototype.query = function (text, params) { return memPool.query(text, params); };
pgMod.Pool.prototype.connect = async function () {
  const c = await memPool.connect();
  return { query: (t, p) => c.query(t, p), release: () => c.release() };
};

process.env.BOT_SHARED_SECRET = 'test-bot-secret';
const { createApp } = await import('../src/app.js');
const { config } = await import('../src/config/index.js');

const app = createApp();
const server = createServer(app);
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const P = (n, c, extra) => console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (extra ? ' :: ' + extra : ''));

const call = async (path, body, { botSecret = false } = {}) => {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(botSecret ? { 'x-bot-secret': 'test-bot-secret' } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const login = (phone, password) => call('/api/auth/login', { phone, password });
const pendingRows = () =>
  memPool.query('SELECT * FROM password_reset_requests').then((r) => r.rows);

// ---------------------------------------------------------------------------
console.log('--- step 1 tells an attacker nothing about who has an account ---');

let r = await call('/api/auth/password/request-reset', { phone: '901111111' });
const known = r;
P('a registered number is accepted', r.status === 200 && r.body.channel === 'bot', String(r.status));
P('and is pointed at the bot', typeof r.body.botLink === 'string' && r.body.botLink.includes('t.me'));

r = await call('/api/auth/password/request-reset', { phone: '905554433' });
P('an unknown number answers the same way',
  r.status === known.status && JSON.stringify(r.body) === JSON.stringify(known.body),
  `${r.status} ${JSON.stringify(r.body)}`);

let rows = await pendingRows();
P('but only the real account got a pending request',
  rows.length === 1 && rows[0].phone === '+998901111111', JSON.stringify(rows.map((x) => x.phone)));

// A blocked account is blocked on purpose: recovery must not hand its login back.
r = await call('/api/auth/password/request-reset', { phone: '903333333' });
P('a blocked account answers the same way too', r.status === 200);
rows = await pendingRows();
P('and gets no pending request', rows.length === 1, JSON.stringify(rows.map((x) => x.phone)));

// ---------------------------------------------------------------------------
console.log('\n--- the code is bot-only, and only when a reset was asked for ---');

r = await call('/api/auth/telegram/web-reset-code', { phone: '901111111', telegramId: 555 });
P('without the bot secret it is refused', r.status === 401, String(r.status));
P('and no code leaks in the body', !r.body.code);

const guessed = await fetch(base + '/api/auth/telegram/web-reset-code', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-bot-secret': 'guessed' },
  body: JSON.stringify({ phone: '901111111', telegramId: 555 }),
});
P('a wrong bot secret is refused', guessed.status === 401, String(guessed.status));

// Nobody asked for a reset on this number.
r = await call('/api/auth/telegram/web-reset-code', { phone: '905554433', telegramId: 555 }, { botSecret: true });
P('an unrequested reset is refused', r.status === 409 && r.body.error?.code === 'RESET_NOT_REQUESTED', r.body.error?.code);

r = await call('/api/auth/telegram/web-reset-code', { phone: '901111111', telegramId: 555 }, { botSecret: true });
P('the requesting number gets a code', r.status === 200 && /^\d{6}$/.test(r.body.code || ''), String(r.status));
P('with a stated lifetime', typeof r.body.ttlMinutes === 'number' && r.body.ttlMinutes > 0);
const code = r.body.code;

// ---------------------------------------------------------------------------
console.log('\n--- step 2 sets the password, and only with the right code ---');

r = await call('/api/auth/password/reset', { phone: '901111111', otp: '000000', newPassword: 'yangiparol' });
P('a wrong code is refused', r.status >= 400, String(r.status));
r = await login('+998901111111', 'yangiparol');
P('and the password is untouched', r.status === 401, String(r.status));

r = await call('/api/auth/password/reset', { phone: '901111111', otp: code, newPassword: 'qisqa' });
P('a password under 6 chars is refused', r.status === 422 || r.status === 400, String(r.status));

// Someone else's number cannot be reset with a code minted for this one.
r = await call('/api/auth/password/reset', { phone: '903333333', otp: code, newPassword: 'yangiparol' });
P('the code does not work on another number', r.status >= 400, String(r.status));

const before = await memPool.query('SELECT password_changed_at FROM users WHERE id = $1', ['u-1']);
P('no session cull has happened yet', before.rows[0].password_changed_at === null,
  String(before.rows[0].password_changed_at));

r = await call('/api/auth/password/reset', { phone: '901111111', otp: code, newPassword: 'yangiparol' });
P('the right code sets the new password', r.status === 200 && r.body.ok === true, JSON.stringify(r.body));
P('and hands back no tokens — the user signs in again', !r.body.accessToken && !r.body.refreshToken);

r = await login('+998901111111', 'yangiparol');
P('the new password works', r.status === 200 && r.body.user?.id === 'u-1', String(r.status));
r = await login('+998901111111', 'eskiparol');
P('the old password stops working', r.status === 401, String(r.status));

// ---------------------------------------------------------------------------
console.log('\n--- and nothing is left behind to reuse ---');

r = await call('/api/auth/password/reset', { phone: '901111111', otp: code, newPassword: 'uchinchiparol' });
P('the code cannot be replayed', r.status >= 400, String(r.status));
r = await login('+998901111111', 'uchinchiparol');
P('so the password did not change again', r.status === 401, String(r.status));

rows = await pendingRows();
P('the pending request is cleared', rows.length === 0, JSON.stringify(rows));

r = await call('/api/auth/telegram/web-reset-code', { phone: '901111111', telegramId: 555 }, { botSecret: true });
P('so the bot will not mint another code', r.status === 409, String(r.status));

// Every session issued before the reset is dead: /auth/refresh compares a
// token's iat against password_changed_at.
const staleRefresh = jwt.sign(
  { sub: 'u-1', role: 'shop_owner', iat: Math.floor(Date.now() / 1000) - 3600 },
  config.jwt.refreshSecret,
  { expiresIn: '30d' }
);
r = await call('/api/auth/refresh', { refreshToken: staleRefresh });
P('a session from before the reset is refused', r.status === 401, String(r.status));

server.close();
