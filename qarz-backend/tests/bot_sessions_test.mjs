// Covers /api/bot/sessions — the store the Telegram bot keeps its users'
// access and refresh tokens in. These endpoints span every bot user, so the
// shared-secret gate is the only thing standing between an anonymous caller
// and everyone's credentials.
process.env.BOT_SHARED_SECRET = 'test-bot-secret-for-ci';

import { createServer } from 'http';

const { default: pgMod } = await import('pg');

const db = new Map(); // telegram_id -> data

pgMod.Pool.prototype.query = async function (text, params = []) {
  const t = String(text).replace(/\s+/g, ' ').trim();

  if (t.includes('SELECT telegram_id, data FROM bot_sessions')) {
    return { rows: [...db.entries()].map(([telegram_id, data]) => ({ telegram_id, data })) };
  }
  if (t.includes('INSERT INTO bot_sessions')) {
    db.set(String(params[0]), JSON.parse(params[1]));
    return { rows: [] };
  }
  if (t.includes('DELETE FROM bot_sessions')) {
    db.delete(String(params[0]));
    return { rows: [] };
  }
  return { rows: [] };
};
pgMod.Pool.prototype.connect = async function () {
  return { query: async (text, params) => pgMod.Pool.prototype.query(text, params), release() {} };
};

const { createApp } = await import('../src/app.js');
const app = createApp();
const server = createServer(app);
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const SECRET = 'test-bot-secret-for-ci';

const call = async (path, opts = {}) => {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const res = await fetch(base + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let j;
  try { j = await res.json(); } catch { j = {}; }
  return { status: res.status, body: j };
};

const withSecret = (s = SECRET) => ({ 'x-bot-secret': s });
const P = (n, c) => console.log((c ? 'PASS' : 'FAIL') + ' ' + n);

// ---- The gate ----
let r = await call('/api/bot/sessions');
P('GET without the secret is rejected', r.status === 403);

r = await call('/api/bot/sessions', { headers: withSecret('wrong-secret-same-len!!') });
P('GET with a wrong secret is rejected', r.status === 403);

r = await call('/api/bot/sessions/1', {
  method: 'PUT',
  body: { data: { accessToken: 'X' } },
});
P('PUT without the secret is rejected', r.status === 403);
P('rejected PUT wrote nothing', db.size === 0);

r = await call('/api/bot/sessions/1', { method: 'DELETE' });
P('DELETE without the secret is rejected', r.status === 403);

// A user access token must NOT open this route — it is bot-only, and a normal
// user holding one must not be able to read other people's sessions.
r = await call('/api/bot/sessions', { headers: { Authorization: 'Bearer whatever' } });
P('a user Bearer token does not open the route', r.status === 403);

// ---- Round trip ----
r = await call('/api/bot/sessions/12345', {
  method: 'PUT',
  headers: withSecret(),
  body: { data: { accessToken: 'A1', refreshToken: 'R1', lang: 'uz' } },
});
P('PUT with the secret succeeds', r.status === 200);
P('PUT stored the payload', db.get('12345').accessToken === 'A1');

r = await call('/api/bot/sessions', { headers: withSecret() });
P('GET returns the stored session', r.body.sessions['12345'].refreshToken === 'R1');
P('GET keys sessions by telegram id string', Object.keys(r.body.sessions)[0] === '12345');

// PUT replaces wholesale — the bot always sends the full merged object, so a
// dropped field must not linger server-side.
await call('/api/bot/sessions/12345', {
  method: 'PUT',
  headers: withSecret(),
  body: { data: { accessToken: 'A2' } },
});
r = await call('/api/bot/sessions', { headers: withSecret() });
P('PUT replaces rather than merges', r.body.sessions['12345'].refreshToken === undefined);

r = await call('/api/bot/sessions/12345', { method: 'DELETE', headers: withSecret() });
P('DELETE with the secret succeeds', r.status === 200);
P('DELETE removed the row', db.has('12345') === false);

// ---- Validation ----
r = await call('/api/bot/sessions/not-a-number', {
  method: 'PUT',
  headers: withSecret(),
  body: { data: {} },
});
P('non-numeric telegram id is rejected', r.status === 422);

r = await call('/api/bot/sessions/-5', {
  method: 'PUT',
  headers: withSecret(),
  body: { data: {} },
});
P('negative telegram id is rejected', r.status === 422);

r = await call('/api/bot/sessions/777', { method: 'PUT', headers: withSecret(), body: {} });
P('missing data field is rejected', r.status === 422);

// Bounded so a bug in the bot cannot write unbounded rows.
r = await call('/api/bot/sessions/777', {
  method: 'PUT',
  headers: withSecret(),
  body: { data: { blob: 'x'.repeat(9000) } },
});
P('oversized session payload is rejected', r.status === 422);
P('oversized payload wrote nothing', db.has('777') === false);

// Telegram ids already exceed 2^31, so BIGINT ids must survive the round trip.
const bigId = '7223344556';
r = await call(`/api/bot/sessions/${bigId}`, {
  method: 'PUT',
  headers: withSecret(),
  body: { data: { accessToken: 'BIG' } },
});
P('large (BIGINT) telegram id is accepted', r.status === 200);
r = await call('/api/bot/sessions', { headers: withSecret() });
P('large telegram id round-trips intact', r.body.sessions[bigId]?.accessToken === 'BIG');

server.close();
