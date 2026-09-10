// PATCH /api/auth/password — setting the website password.
//
// THE BUG: registering through the Telegram bot generated a random password and
// showed it to nobody, so the account's owner could never sign in on the web —
// the login form asked for something they had never been given. The bot now
// asks for a password, but every account created before that still holds an
// unknowable hash, and this endpoint is how its owner replaces it (via the
// bot's "🔑 Sayt paroli" button).
//
// Skipping the current-password check is the delicate part: it is what makes
// those accounts recoverable, and it must stay reachable only by our own bot.
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
// What bot registration used to produce: a random string nobody ever saw.
const unknowableHash = bcrypt.hashSync('tg-3kd91mAqz7B2xX1!', 10);

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
  CREATE TABLE shops (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL
  );
  INSERT INTO users (id, role, phone, password_hash) VALUES ('u-web', 'personal', '+998901111111', '${knownHash}');
  INSERT INTO users (id, role, phone, password_hash) VALUES ('u-bot', 'personal', '+998902222222', '${unknowableHash}');
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
const tokenFor = (sub, role) => jwt.sign({ sub, role }, config.jwt.accessSecret, { expiresIn: '1h' });

const setPassword = async (token, body, botSecret = false) => {
  const res = await fetch(base + '/api/auth/password', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(botSecret ? { 'x-bot-secret': 'test-bot-secret' } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const login = async (phone, password) => {
  const res = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

// ---------------------------------------------------------------------------
console.log('--- the bot-registered account can finally get a usable password ---');

let r = await setPassword(tokenFor('u-bot', 'personal'), { newPassword: 'yangiparol' }, true);
P('bot may set a password without the current one', r.status === 200, String(r.status));

r = await login('+998902222222', 'yangiparol');
P('and the web login now works', r.status === 200 && r.body.user?.id === 'u-bot', String(r.status));

// ---------------------------------------------------------------------------
console.log('\n--- without the bot secret, the old password is required ---');

r = await setPassword(tokenFor('u-web', 'personal'), { newPassword: 'boshqaparol' });
P('omitting the current password is refused', r.status === 400 && r.body.error?.code === 'CURRENT_PASSWORD_REQUIRED', r.body.error?.code);

r = await setPassword(tokenFor('u-web', 'personal'), { currentPassword: 'notiristi', newPassword: 'boshqaparol' });
P('a wrong current password is refused', r.status === 401, String(r.status));

r = await login('+998901111111', 'eskiparol');
P('the failed attempts changed nothing', r.status === 200, String(r.status));

r = await setPassword(tokenFor('u-web', 'personal'), { currentPassword: 'eskiparol', newPassword: 'boshqaparol' });
P('the right current password is accepted', r.status === 200, String(r.status));

r = await login('+998901111111', 'boshqaparol');
P('the new password works', r.status === 200, String(r.status));
r = await login('+998901111111', 'eskiparol');
P('the old password stops working', r.status === 401, String(r.status));

// ---------------------------------------------------------------------------
console.log('\n--- and the ways it must refuse ---');

// The bypass is the sensitive part: an unauthenticated caller must never reach
// it, or the shared secret alone would be enough to reset anyone's password.
const res = await fetch(base + '/api/auth/password', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', 'x-bot-secret': 'test-bot-secret' },
  body: JSON.stringify({ newPassword: 'zzzzzzzz' }),
});
P('no token -> 401 even with the bot secret', res.status === 401, String(res.status));

// A token only ever changes its own account: userId comes from the token, never
// from the body, so an extra field cannot redirect the write.
r = await setPassword(tokenFor('u-bot', 'personal'), { newPassword: 'hijacked', userId: 'u-web' }, true);
P('userId in the body is ignored', r.status === 200);
r = await login('+998901111111', 'hijacked');
P('the other account was not touched', r.status === 401, String(r.status));

r = await setPassword(tokenFor('u-off', 'personal'), { newPassword: 'yangiparol' }, true);
P('a blocked account cannot set a password', r.status === 401, String(r.status));

r = await setPassword(tokenFor('u-bot', 'personal'), { newPassword: 'qisqa' }, true);
P('a too-short password is rejected', r.status === 422 || r.status === 400, String(r.status));

// ---------------------------------------------------------------------------
console.log('\n--- changing a password ends the other sessions ---');

// THE BUG: refresh tokens are 30-day JWTs with no blocklist, so changing a
// password did nothing to sessions already issued. Someone who changes it
// BECAUSE their account was compromised left the attacker's refresh token — and
// the attacker's bot session — valid for up to another month.
const refresh = async (refreshToken) => {
  const res = await fetch(base + '/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

// Earlier sections already changed this account's password, so put it back to
// the "never changed" state this scenario starts from.
await memPool.query('UPDATE users SET password_changed_at = NULL WHERE id = $1', ['u-bot']);

// A session that existed before the change — the attacker's, in the story above.
const staleRefresh = jwt.sign(
  { sub: 'u-bot', role: 'personal', iat: Math.floor(Date.now() / 1000) - 3600 },
  config.jwt.refreshSecret,
  { expiresIn: '30d' }
);
P('it works before the password changes', (await refresh(staleRefresh)).status === 200);

r = await setPassword(tokenFor('u-bot', 'personal'), { newPassword: 'butunlayyangi' }, true);
P('the change succeeds', r.status === 200, String(r.status));

const after = await refresh(staleRefresh);
P('the older session can no longer refresh', after.status === 401, String(after.status));

// ...but the caller that just changed it must NOT be logged out: someone
// setting a password from the bot would be bounced to /start on their next tap.
P('the change hands back a fresh pair', Boolean(r.body.accessToken && r.body.refreshToken));
const renewed = await refresh(r.body.refreshToken);
P('and that pair still refreshes', renewed.status === 200, String(renewed.status));

// An account that never changed its password (password_changed_at IS NULL) must
// keep working — the column is added to a live table under running traffic.
const untouched = jwt.sign(
  { sub: 'u-web', role: 'personal', iat: Math.floor(Date.now() / 1000) - 86400 },
  config.jwt.refreshSecret,
  { expiresIn: '30d' }
);
await memPool.query('UPDATE users SET password_changed_at = NULL WHERE id = $1', ['u-web']);
P('a never-changed account is unaffected', (await refresh(untouched)).status === 200);

server.close();
