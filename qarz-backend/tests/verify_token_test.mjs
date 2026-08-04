// Regression tests for the two account-takeover holes closed in the auth layer:
//
//  1. POST /api/auth/telegram/request-link used to return the SMS OTP in its
//     own (public, unauthenticated) response body. Anyone could request a code
//     for someone else's number, read it, and bind their own Telegram account.
//  2. The Telegram registration handshake handed the registration OTP to
//     whoever presented the verify token — and the requester holds that token,
//     so it bypassed phone verification entirely for any number.
//
// Runs against the real Express app with a stateful in-memory pg stub.
process.env.BOT_SHARED_SECRET = 'test-bot-secret-0123456789abcdef';
process.env.TELEGRAM_BOT_USERNAME = 'test_bot';

import { createServer } from 'http';

const { default: pgMod } = await import('pg');

const db = { users: [], otps: [] };
let seq = 0;
const uid = () => `id-${++seq}`;

pgMod.Pool.prototype.query = async function (text, params = []) {
  const t = String(text).replace(/\s+/g, ' ').trim();

  if (t.includes('SELECT id FROM users WHERE phone')) {
    const u = db.users.find((x) => x.phone === params[0]);
    return { rows: u ? [{ id: u.id }] : [] };
  }
  if (t.startsWith('SELECT * FROM users WHERE phone')) {
    const u = db.users.find((x) => x.phone === params[0]);
    return { rows: u ? [u] : [] };
  }
  if (t.includes('UPDATE otp_codes SET consumed_at = now() WHERE phone')) {
    db.otps.forEach((o) => {
      if (o.phone === params[0] && o.purpose === params[1] && !o.consumed_at) {
        o.consumed_at = new Date();
      }
    });
    return { rows: [] };
  }
  if (t.includes('INSERT INTO otp_codes')) {
    db.otps.push({
      id: uid(), phone: params[0], code_hash: params[1], purpose: params[2],
      attempts: 0, consumed_at: null, expires_at: params[3], created_at: new Date(),
    });
    return { rows: [] };
  }
  if (t.includes('FROM otp_codes WHERE code_hash')) {
    const rows = db.otps.filter((o) => o.code_hash === params[0] && o.purpose === params[1]);
    return { rows: rows.slice(0, 1) };
  }
  if (t.includes('FROM otp_codes WHERE phone')) {
    const rows = db.otps
      .filter((o) => o.phone === params[0] && o.purpose === params[1] && !o.consumed_at)
      .sort((a, b) => b.created_at - a.created_at);
    return { rows: rows.slice(0, 1) };
  }
  if (t.includes('UPDATE otp_codes SET consumed_at = now() WHERE id')) {
    const o = db.otps.find((x) => x.id === params[0]);
    if (o && !o.consumed_at) o.consumed_at = new Date();
    return { rows: [], rowCount: o ? 1 : 0 };
  }
  if (t.includes('DELETE FROM otp_codes WHERE id')) {
    const i = db.otps.findIndex((x) => x.id === params[0]);
    if (i >= 0) db.otps.splice(i, 1);
    return { rows: [], rowCount: i >= 0 ? 1 : 0 };
  }
  if (t.startsWith('INSERT INTO users')) {
    const u = {
      id: uid(), role: params[0] !== undefined && t.includes("'personal'") ? 'personal' : 'personal',
      phone: params[0], password_hash: params[1], full_name: params[2],
      telegram_id: params[3], is_active: true,
    };
    db.users.push(u);
    return { rows: [u] };
  }
  return { rows: [] };
};
pgMod.Pool.prototype.connect = async function () {
  return { query: (t, p) => pgMod.Pool.prototype.query(t, p), release() {} };
};

const { createApp } = await import('../src/app.js');
const { config } = await import('../src/config/index.js');

const app = createApp();
const server = createServer(app);
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const call = async (path, opts = {}) => {
  const res = await fetch(base + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let j; try { j = await res.json(); } catch { j = {}; }
  return { status: res.status, body: j };
};
const BOT = { 'x-bot-secret': config.botSharedSecret };

let failures = 0;
const P = (n, c, extra = '') => {
  if (!c) failures++;
  console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (extra ? ' :: ' + extra : ''));
};

const VICTIM = '+998901234567';

// ---------------------------------------------------------------- #1 OTP leak
console.log('--- request-link must never echo the OTP ---');
db.users.push({ id: 'victim', phone: VICTIM, role: 'shop_owner', is_active: true, password_hash: 'x' });

let r = await call('/api/auth/telegram/request-link', { method: 'POST', body: { phone: VICTIM } });
P('request-link -> 200', r.status === 200, `got ${r.status}`);
P('response does NOT contain the code', r.body.code === undefined, `body=${JSON.stringify(r.body)}`);
P('an OTP was actually issued', db.otps.some((o) => o.purpose === 'telegram_link'));

// ------------------------------------------------- #2 verify-token handshake
console.log('\n--- Telegram registration handshake ---');
const NEWPHONE = '+998907654321';

r = await call('/api/auth/register/request-otp', {
  method: 'POST', body: { phone: NEWPHONE, channel: 'telegram' },
});
P('channel=telegram reaches the telegram branch (not SMS)', r.body.channel === 'telegram',
  `got ${JSON.stringify(r.body)}`);
const verifyToken = r.body.verifyToken;
P('a verify token is issued', /^[a-f0-9]{64}$/.test(verifyToken || ''), `got ${verifyToken}`);
P('no OTP code in the response', r.body.code === undefined);
P('deep link points at the bot', String(r.body.deepLink).includes(`start=verify_${verifyToken}`));

r = await call(`/api/auth/verify-status/${verifyToken}`);
P('verify-status starts unverified', r.body.verified === false, JSON.stringify(r.body));
P('verify-status never returns a code', r.body.code === undefined);

// Attacker path: no bot secret at all
r = await call('/api/auth/telegram/confirm-verify-token', {
  method: 'POST', body: { token: verifyToken, telegramId: 999, phone: NEWPHONE },
});
P('confirm-verify-token without bot secret -> 401', r.status === 401, `got ${r.status}`);

// Attacker path: has the bot secret but a different (own) phone
r = await call('/api/auth/telegram/confirm-verify-token', {
  method: 'POST', headers: BOT,
  body: { token: verifyToken, telegramId: 999, phone: '+998905555555' },
});
P('confirm-verify-token with mismatched phone -> 403', r.status === 403, `got ${r.status} ${r.body?.error?.code}`);

// Registration must still be refused while unconfirmed
r = await call('/api/auth/register/personal', {
  method: 'POST', body: { phone: NEWPHONE, password: 'secret123', verifyToken },
});
P('register with unconfirmed token -> 400 NOT_VERIFIED',
  r.status === 400 && r.body?.error?.code === 'NOT_VERIFIED', `got ${r.status} ${r.body?.error?.code}`);
P('no account created yet', !db.users.some((u) => u.phone === NEWPHONE));

// Happy path: the bot confirms with the contact-proven phone
r = await call('/api/auth/telegram/confirm-verify-token', {
  method: 'POST', headers: BOT,
  body: { token: verifyToken, telegramId: 555, phone: NEWPHONE },
});
P('bot confirms with matching phone -> 200', r.status === 200, `got ${r.status} ${JSON.stringify(r.body)}`);

r = await call(`/api/auth/verify-status/${verifyToken}`);
P('verify-status now verified', r.body.verified === true, JSON.stringify(r.body));
P('still no code leaked after verification', r.body.code === undefined);

r = await call('/api/auth/register/personal', {
  method: 'POST', body: { phone: NEWPHONE, password: 'secret123', verifyToken },
});
P('register with confirmed token -> 201', r.status === 201, `got ${r.status} ${JSON.stringify(r.body)}`);
P('account created', db.users.some((u) => u.phone === NEWPHONE));

// Replay
r = await call('/api/auth/register/personal', {
  method: 'POST', body: { phone: '+998909999999', password: 'secret123', verifyToken },
});
P('verify token is single-use', r.status === 400, `got ${r.status} ${r.body?.error?.code}`);

// Double-confirm
r = await call('/api/auth/telegram/confirm-verify-token', {
  method: 'POST', headers: BOT, body: { token: verifyToken, telegramId: 555, phone: NEWPHONE },
});
P('consumed token cannot be re-confirmed', r.status >= 400, `got ${r.status}`);

// Malformed token is rejected before touching the database
r = await call('/api/auth/verify-status/not-a-token');
P('malformed verify token -> 422', r.status === 422, `got ${r.status}`);

server.close();
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall green');
process.exit(failures ? 1 : 0);
