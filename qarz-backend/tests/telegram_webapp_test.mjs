// Telegram Mini App login: POST /api/auth/telegram/webapp.
//
// There is no live Telegram client in this environment, so a real Mini App
// launch cannot be observed end-to-end here. What CAN be verified rigorously
// is the thing that actually matters: the signature algorithm. This suite signs
// initData itself, the same way Telegram's client does — HMAC-SHA256 twice,
// first deriving a secret key from the bot token, then hashing the sorted
// "key=value" pairs — and drives it through the real Express app with pg-mem,
// so both the crypto and the route wiring are exercised together.
import { createServer } from 'http';
import crypto from 'crypto';
import { newDb } from 'pg-mem';
import { randomUUID } from 'crypto';

const BOT_TOKEN = 'test-bot-token-123456';
process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;

const mem = newDb();
mem.public.registerFunction({ name: 'now', returns: 'timestamptz', implementation: () => new Date() });
mem.public.registerFunction({
  name: 'gen_random_uuid', returns: 'text', implementation: () => randomUUID(), impure: true,
});

mem.public.none(`
  CREATE TABLE users (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    role TEXT NOT NULL,
    phone TEXT UNIQUE,
    password_hash TEXT,
    full_name TEXT,
    telegram_id BIGINT UNIQUE,
    parent_shop_id TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  -- One account already linked via the bot's contact-share flow (this is what
  -- linking actually sets: telegram_id on an existing users row).
  INSERT INTO users (id, role, phone, telegram_id) VALUES ('u-linked', 'shop_owner', '+998901111111', 555000111);
  INSERT INTO users (id, role, phone, telegram_id, is_active) VALUES ('u-blocked', 'shop_owner', '+998902222222', 555000222, FALSE);
`);

const { Pool } = mem.adapters.createPg();
const memPool = new Pool();
const { default: pgMod } = await import('pg');
pgMod.Pool.prototype.query = function (text, params) { return memPool.query(text, params); };
pgMod.Pool.prototype.connect = async function () {
  const c = await memPool.connect();
  return { query: (t, p) => c.query(t, p), release: () => c.release() };
};

const { createApp } = await import('../src/app.js');
const app = createApp();
const server = createServer(app);
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const P = (n, c, extra) => console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (extra ? ' :: ' + extra : ''));

/**
 * Sign a Telegram Mini App launch exactly the way a real client does, so the
 * fixture is a faithful stand-in for one — not a shortcut that only happens to
 * satisfy this codebase's own validator.
 */
const signInitData = (fields, botToken = BOT_TOKEN) => {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  const qs = new URLSearchParams({ ...fields, hash });
  return qs.toString();
};

const launch = (telegramId, overrides = {}) => {
  const fields = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'AAF_test_query_id',
    user: JSON.stringify({ id: telegramId, first_name: 'Ali', username: 'ali_test' }),
    ...overrides,
  };
  return signInitData(fields);
};

const post = async (path, body) => {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

// ---------------------------------------------------------------------------
console.log('--- a genuine launch signs someone in ---');

let r = await post('/api/auth/telegram/webapp', { initData: launch(555000111) });
P('a validly signed launch succeeds', r.status === 200, JSON.stringify(r.body));
P('it returns the linked account', r.body.user?.id === 'u-linked' && r.body.user?.role === 'shop_owner', JSON.stringify(r.body.user));
P('with a usable token pair', typeof r.body.accessToken === 'string' && typeof r.body.refreshToken === 'string');

// ---------------------------------------------------------------------------
console.log('\n--- what must be refused ---');

r = await post('/api/auth/telegram/webapp', { initData: launch(999999999) });
P('an unlinked Telegram id is refused', r.status === 404 && r.body.error?.code === 'TELEGRAM_NOT_LINKED', r.body.error?.code);

r = await post('/api/auth/telegram/webapp', { initData: launch(555000222) });
P('a blocked account cannot sign in', r.status === 401, String(r.status));

// A single flipped character anywhere invalidates the whole signature — the
// entire point of hashing every field together.
const valid = launch(555000111);
const tampered = valid.replace('Ali', 'Bek');
r = await post('/api/auth/telegram/webapp', { initData: tampered });
P('a tampered payload is rejected', r.status === 401, String(r.status));

r = await post('/api/auth/telegram/webapp', {
  initData: signInitData({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: 555000111 }),
  }, 'wrong-bot-token'),
});
P('a signature from the wrong bot token is rejected', r.status === 401, String(r.status));

// A signed payload never expires on its own; without an explicit age check a
// captured launch (a saved link, a screenshot) would authenticate forever.
r = await post('/api/auth/telegram/webapp', {
  initData: launch(555000111, { auth_date: String(Math.floor(Date.now() / 1000) - 25 * 60 * 60) }),
});
P('a launch older than 24h is rejected', r.status === 401, String(r.status));

r = await post('/api/auth/telegram/webapp', {
  initData: signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: 'not-json{' }),
});
P('an unparseable user field is rejected', r.status === 401, String(r.status));

r = await post('/api/auth/telegram/webapp', { initData: '' });
P('an empty initData is rejected by validation', r.status === 422 || r.status === 400, String(r.status));

r = await post('/api/auth/telegram/webapp', {});
P('a missing initData field is rejected by validation', r.status === 422 || r.status === 400, String(r.status));

server.close();

// ---------------------------------------------------------------------------
// An unconfigured bot token must fail closed, the same instinct as an
// unconfigured Click secret elsewhere in this codebase — but config.js reads
// TELEGRAM_BOT_TOKEN once at import time, and it is already set for every test
// above, so this needs its own process to observe the unconfigured case.
console.log('\n--- fails closed with no bot token configured ---');

const { spawnSync } = await import('child_process');
const child = spawnSync(
  process.execPath,
  ['-e', `
    const { verifyTelegramWebAppData } = await import('./src/utils/telegramAuth.js');
    const result = verifyTelegramWebAppData('auth_date=123&user=%7B%22id%22%3A1%7D&hash=whatever');
    console.log(JSON.stringify({ result }));
  `],
  {
    encoding: 'utf8',
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TELEGRAM_BOT_TOKEN: '' },
  }
);
const line = (child.stdout || '').trim().split('\n').filter((l) => l.startsWith('{')).pop();
const parsed = line ? JSON.parse(line) : null;
P('verification refuses outright with no bot token', parsed?.result === null, child.stderr?.slice(-300) || line);
