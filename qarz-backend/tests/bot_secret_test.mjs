// Confirms the bot-secret bypass actually WORKS when configured correctly —
// register_otp_test.mjs only checked that a wrong/missing secret is rejected;
// this checks the matching-secret path succeeds, since config is read once
// at import time and needs BOT_SHARED_SECRET set *before* the app loads.
process.env.BOT_SHARED_SECRET = 'test-bot-secret-for-ci';

import { createServer } from 'http';

const { default: pgMod } = await import('pg');

const db = { users: [] };
let seq = 0;
const uid = () => `id-${++seq}`;

pgMod.Pool.prototype.query = async function (text, params = []) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (t.includes('SELECT id FROM users WHERE phone')) {
    const u = db.users.find((x) => x.phone === params[0]);
    return { rows: u ? [{ id: u.id }] : [] };
  }
  if (t.includes('INSERT INTO users')) {
    const u = { id: uid(), role: 'personal', phone: params[0], password_hash: params[1], full_name: params[2], is_active: true };
    db.users.push(u);
    return { rows: [u] };
  }
  return { rows: [] };
};
pgMod.Pool.prototype.connect = async function () {
  return { query: async (text, params) => pgMod.Pool.prototype.query(text, params), release() {} };
};

const { createApp } = await import('../src/app.js');
const { config } = await import('../src/config/index.js');
const app = createApp();
const server = createServer(app);
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const call = async (path, opts = {}) => {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const res = await fetch(base + path, {
    method: opts.method || 'GET', headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let j; try { j = await res.json(); } catch { j = {}; }
  return { status: res.status, body: j };
};
const P = (n, c, extra = '') => console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (extra ? ' :: ' + extra : ''));

console.log('--- bot-secret bypass, positive case (config actually loaded) ---');
P('config picked up BOT_SHARED_SECRET', config.botSharedSecret === 'test-bot-secret-for-ci');

// This mirrors exactly what the bot's api.js sends: no `otp` field, but the
// correct x-bot-secret header — the same registration payload a real Telegram
// user would trigger after sharing their contact.
let r = await call('/api/auth/register/personal', {
  method: 'POST',
  headers: { 'x-bot-secret': 'test-bot-secret-for-ci' },
  body: { phone: '901234567', password: 'parol123', fullName: 'Bot User' },
});
P('correct bot secret + no OTP -> 201 (registration succeeds)', r.status === 201, `got ${r.status} ${JSON.stringify(r.body)}`);
P('account actually created', db.users.length === 1);
P('tokens issued', !!r.body.accessToken && !!r.body.refreshToken);

// Same call again for a different phone but with a slightly-off secret must still fail
r = await call('/api/auth/register/personal', {
  method: 'POST',
  headers: { 'x-bot-secret': 'test-bot-secret-for-ci-EXTRA' },
  body: { phone: '901112244', password: 'parol123', fullName: 'Impostor' },
});
P('near-miss secret still rejected', r.status >= 400, `got ${r.status}`);
P('no extra account created', db.users.length === 1);

server.close();
