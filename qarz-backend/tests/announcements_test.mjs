// Platform announcements: broadcast, and what a shop owner sees afterwards.
//
// THE BUG: the broadcast pushed over Telegram, fell back to SMS, and stored
// nothing. An owner who missed the message had no way to find it, and the web
// app had nowhere to show it. In practice no shop owner had a telegram_id at
// all, so every announcement went out as paid SMS through a provider that is
// not configured — the message reached nobody and left no trace.
//
// It is now stored first and pushed second: the web copy is the reliable
// channel, Telegram is the nudge, and SMS is gone.
import { createServer } from 'http';
import { newDb } from 'pg-mem';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

const mem = newDb();
mem.public.registerFunction({ name: 'now', returns: 'timestamptz', implementation: () => new Date() });
mem.public.registerFunction({
  name: 'gen_random_uuid', returns: 'text', implementation: () => randomUUID(), impure: true,
});

mem.public.none(`
  CREATE TABLE users (
    id TEXT PRIMARY KEY, role TEXT NOT NULL, phone TEXT, full_name TEXT,
    telegram_id BIGINT, parent_shop_id TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
  );
  CREATE TABLE shops (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL);
  CREATE TABLE announcements (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    body TEXT NOT NULL, target_type TEXT NOT NULL DEFAULT 'all', created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE announcement_reads (
    announcement_id TEXT NOT NULL, user_id TEXT NOT NULL,
    read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (announcement_id, user_id)
  );
  CREATE TABLE audit_logs (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id TEXT, action TEXT NOT NULL, meta TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  INSERT INTO users (id, role, phone, telegram_id) VALUES ('admin-1', 'super_admin', '+998900000000', 111);
  -- The realistic mix: one owner linked to Telegram, one not, one blocked.
  INSERT INTO users (id, role, phone, telegram_id) VALUES ('owner-tg', 'shop_owner', '+998901111111', 840369610);
  INSERT INTO users (id, role, phone) VALUES ('owner-notg', 'shop_owner', '+998902222222');
  INSERT INTO users (id, role, phone, is_active) VALUES ('owner-off', 'shop_owner', '+998903333333', FALSE);
  CREATE TABLE subscriptions (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'start',
    status TEXT NOT NULL DEFAULT 'trial', ends_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  -- Staff and personal users are not the audience.
  INSERT INTO users (id, role, phone, parent_shop_id) VALUES ('staff-1', 'staff', '+998904444444', 'shop-1');
  INSERT INTO shops (id, owner_id, name) VALUES ('shop-1', 'owner-tg', 'Test Market');
  INSERT INTO shops (id, owner_id, name) VALUES ('shop-2', 'owner-notg', 'Second Market');
  INSERT INTO subscriptions (shop_id, plan, status, ends_at) VALUES ('shop-1', 'pro', 'active', '2030-01-01');
  INSERT INTO subscriptions (shop_id, plan, status, ends_at) VALUES ('shop-2', 'start', 'trial', '2030-01-01');
`);

const { Pool } = mem.adapters.createPg();
const memPool = new Pool();
const { default: pgMod } = await import('pg');
pgMod.Pool.prototype.query = function (text, params) { return memPool.query(text, params); };
pgMod.Pool.prototype.connect = async function () {
  return { query: (t, p) => memPool.query(t, p), release: () => {} };
};

// Watch what actually leaves the process. An SMS here would be a regression:
// the whole point of storing announcements was to stop paying for them.
const telegramSends = [];
const smsSends = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('api.telegram.org')) {
    telegramSends.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
  }
  if (u.includes('eskiz.uz')) {
    smsSends.push(u);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }
  return realFetch(url, init);
};

process.env.TELEGRAM_BOT_TOKEN = 'test-token';
const { createApp } = await import('../src/app.js');
const { config } = await import('../src/config/index.js');

const app = createApp();
const server = createServer(app);
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const P = (n, c, extra) => console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (extra ? ' :: ' + extra : ''));
const tokenFor = (sub, role) => jwt.sign({ sub, role }, config.jwt.accessSecret, { expiresIn: '1h' });
const call = async (method, path, token, body) => {
  const res = await realFetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const adminToken = tokenFor('admin-1', 'super_admin');
const tgOwner = tokenFor('owner-tg', 'shop_owner');
const noTgOwner = tokenFor('owner-notg', 'shop_owner');

// ---------------------------------------------------------------------------
console.log('--- sending ---');

let r = await call('POST', '/api/admin/broadcast', adminToken, { message: 'Ertaga texnik ishlar' });
P('broadcast succeeds', r.status === 200 && r.body.ok === true, String(r.status));
P('it counts the active owners only', r.body.totalOwners === 2, String(r.body.totalOwners));
P('and returns the stored announcement id', Boolean(r.body.announcementId));

P('the linked owner got a Telegram push', telegramSends.length === 1, String(telegramSends.length));
P('addressed to their chat', telegramSends[0]?.chat_id === 840369610, String(telegramSends[0]?.chat_id));
// The regression this guards: SMS used to go to every owner without Telegram.
P('NO SMS was sent', smsSends.length === 0, String(smsSends.length));

const stored = await memPool.query('SELECT body, created_by FROM announcements');
P('the announcement was stored once', stored.rows.length === 1, String(stored.rows.length));
P('with its author', stored.rows[0].created_by === 'admin-1');

// Broadcasting reaches every shop on the platform at once, so it is exactly the
// kind of action that has to be attributable afterwards.
const audit = await memPool.query('SELECT actor_id, action, meta FROM audit_logs');
P('the broadcast is audit-logged', audit.rows.length === 1, String(audit.rows.length));
P('under the admin who sent it', audit.rows[0]?.actor_id === 'admin-1', audit.rows[0]?.actor_id);
P('with action "broadcast"', audit.rows[0]?.action === 'broadcast', audit.rows[0]?.action);
const meta = JSON.parse(audit.rows[0]?.meta || '{}');
P('and the message plus delivery counts', meta.message === 'Ertaga texnik ishlar' && meta.totalOwners === 2, JSON.stringify(meta));

// ---------------------------------------------------------------------------
console.log('\n--- what each owner sees ---');

// The owner with no Telegram is exactly who the stored copy is for.
r = await call('GET', '/api/shop/announcements', noTgOwner);
P('an owner without Telegram still receives it', r.body.announcements?.length === 1, String(r.body.announcements?.length));
P('and it counts as unread', r.body.unreadCount === 1, String(r.body.unreadCount));
P('carrying the message body', r.body.announcements[0].body === 'Ertaga texnik ishlar');

// The Telegram owner sees it in the app too — the push is a nudge, not the copy.
r = await call('GET', '/api/shop/announcements', tgOwner);
P('the Telegram owner sees it in the app as well', r.body.unreadCount === 1, String(r.body.unreadCount));
const annId = r.body.announcements[0].id;

// ---------------------------------------------------------------------------
console.log('\n--- reading ---');

r = await call('POST', `/api/shop/announcements/${annId}/read`, tgOwner);
P('marking read succeeds', r.status === 200, String(r.status));

r = await call('GET', '/api/shop/announcements', tgOwner);
P('it is no longer unread for that owner', r.body.unreadCount === 0, String(r.body.unreadCount));
P('but is still listed, as history', r.body.announcements.length === 1);
P('flagged as read', r.body.announcements[0].is_read === true);

// Read state is per user: one owner dismissing it must not silence it for
// everyone, which is what a single "read" flag on the announcement would do.
r = await call('GET', '/api/shop/announcements', noTgOwner);
P('the other owner still has it unread', r.body.unreadCount === 1, String(r.body.unreadCount));

// The bar and the bell can both dismiss the same item, in two tabs.
r = await call('POST', `/api/shop/announcements/${annId}/read`, tgOwner);
P('marking read twice is not an error', r.status === 200, String(r.status));
const reads = await memPool.query('SELECT * FROM announcement_reads WHERE user_id = $1', ['owner-tg']);
P('and does not duplicate the row', reads.rows.length === 1, String(reads.rows.length));

// ---------------------------------------------------------------------------
console.log('\n--- who may reach these routes ---');

r = await call('GET', '/api/shop/announcements', tokenFor('staff-1', 'staff'));
P('staff cannot read announcements', r.status === 403, String(r.status));

r = await call('POST', '/api/admin/broadcast', tgOwner, { message: 'hack' });
P('a shop owner cannot broadcast', r.status === 403, String(r.status));

r = await call('POST', `/api/shop/announcements/${randomUUID()}/read`, tgOwner);
P('marking an unknown announcement read is 404', r.status === 404, String(r.status));

r = await call('POST', '/api/shop/announcements/not-a-uuid/read', tgOwner);
P('a malformed id is rejected by validation', r.status === 422 || r.status === 400, String(r.status));

r = await call('POST', '/api/admin/broadcast', adminToken, { message: '' });
P('an empty message is refused', r.status === 422 || r.status === 400, String(r.status));

// ---------------------------------------------------------------------------
console.log('\n--- targeted broadcasting ---');

r = await call('POST', '/api/admin/broadcast', adminToken, { message: 'Faqat sinovdagilarga', target: 'trial' });
P('targeted trial broadcast succeeds', r.status === 200 && r.body.target === 'trial', String(r.status));
P('it counts 1 trial owner', r.body.totalOwners === 1, String(r.body.totalOwners));

r = await call('POST', '/api/admin/broadcast', adminToken, { message: 'Faqat pro tarifga', target: 'plan_pro' });
P('targeted plan_pro broadcast succeeds', r.status === 200 && r.body.target === 'plan_pro', String(r.status));
P('it counts 1 pro owner', r.body.totalOwners === 1, String(r.body.totalOwners));

server.close();
