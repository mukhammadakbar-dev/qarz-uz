// PATCH /api/admin/shops/:shopId/subscription — manual subscription activation,
// which is how shops are billed until Click is integrated.
//
// The arithmetic here decides whether a paying customer gets what they paid
// for, so it runs against pg-mem with real SQL rather than a stubbed driver.
import { createServer } from 'http';
import { newDb } from 'pg-mem';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

const mem = newDb();
mem.public.registerFunction({ name: 'now', returns: 'timestamptz', implementation: () => new Date() });
// pg-mem ships very few native functions; the real schema defaults its primary
// keys with gen_random_uuid(), so provide it rather than reshaping the tables.
mem.public.registerFunction({
  name: 'gen_random_uuid',
  returns: 'text',
  implementation: () => randomUUID(),
  impure: true,
});
// /api/admin/stats buckets by calendar month; only 'month' is ever asked for.
const truncate = (unit, d) => {
  const dt = new Date(d);
  if (unit !== 'month') throw new Error(`date_trunc unit not stubbed: ${unit}`);
  return new Date(dt.getFullYear(), dt.getMonth(), 1);
};
for (const argType of ['date', 'timestamptz']) {
  mem.public.registerFunction({
    name: 'date_trunc',
    args: ['text', argType],
    returns: 'timestamptz',
    implementation: truncate,
  });
}

mem.public.none(`
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    phone TEXT,
    full_name TEXT,
    parent_shop_id TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
  );
  CREATE TABLE shops (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL
  );
  CREATE TABLE subscriptions (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    plan TEXT NOT NULL DEFAULT 'start',
    status TEXT NOT NULL DEFAULT 'trial',
    starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ends_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE plans (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price_uzs BIGINT NOT NULL DEFAULT 0,
    monthly_sms INTEGER NOT NULL DEFAULT 30
  );
  CREATE TABLE sms_balance (
    shop_id TEXT PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
    monthly_limit INTEGER NOT NULL DEFAULT 30,
    remaining INTEGER NOT NULL DEFAULT 30,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE subscription_payments (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    amount_uzs NUMERIC(14,2) NOT NULL,
    method TEXT NOT NULL DEFAULT 'manual',
    transaction_id TEXT,
    plan TEXT NOT NULL,
    months INTEGER NOT NULL,
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    note TEXT,
    recorded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  -- Not exercised here, but /api/admin/stats aggregates over it in the same
  -- request as the revenue figure this suite does check.
  CREATE TABLE notifications (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    channel TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE audit_logs (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id TEXT,
    action TEXT NOT NULL,
    meta TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  INSERT INTO users (id, role, phone) VALUES ('admin-1', 'super_admin', '+998900000000');
  INSERT INTO users (id, role, phone) VALUES ('owner-1', 'shop_owner', '+998901111111');
  INSERT INTO users (id, role, phone) VALUES ('owner-2', 'shop_owner', '+998902222222');
  INSERT INTO users (id, role, phone) VALUES ('owner-3', 'shop_owner', '+998903333333');

  INSERT INTO plans (code, name, price_uzs, monthly_sms) VALUES ('start', 'Start', 50000, 30);
  INSERT INTO plans (code, name, price_uzs, monthly_sms) VALUES ('pro', 'Pro', 150000, 200);
  INSERT INTO plans (code, name, price_uzs, monthly_sms) VALUES ('business', 'Business', 300000, 500);

  -- LAPSED: trial ended a month ago
  INSERT INTO shops (id, owner_id, name) VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'owner-1', 'Lapsed Market');
  INSERT INTO subscriptions (id, shop_id, plan, status, ends_at)
    VALUES ('sub-lapsed', 'aaaaaaaa-0000-4000-8000-000000000001', 'start', 'expired', now() - interval '30 days');
  INSERT INTO sms_balance (shop_id, monthly_limit, remaining) VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 30, 12);

  -- STILL VALID: 20 days left, renewing early
  INSERT INTO shops (id, owner_id, name) VALUES ('aaaaaaaa-0000-4000-8000-000000000002', 'owner-2', 'Valid Market');
  INSERT INTO subscriptions (id, shop_id, plan, status, ends_at)
    VALUES ('sub-valid', 'aaaaaaaa-0000-4000-8000-000000000002', 'pro', 'active', now() + interval '20 days');
  INSERT INTO sms_balance (shop_id, monthly_limit, remaining) VALUES ('aaaaaaaa-0000-4000-8000-000000000002', 200, 150);

  -- BLOCKED by moderation, and still paying. Renewing must not unblock it.
  INSERT INTO users (id, role, phone) VALUES ('owner-4', 'shop_owner', '+998904444444');
  INSERT INTO shops (id, owner_id, name) VALUES ('aaaaaaaa-0000-4000-8000-000000000004', 'owner-4', 'Blocked Market');
  INSERT INTO subscriptions (id, shop_id, plan, status, ends_at)
    VALUES ('sub-blocked', 'aaaaaaaa-0000-4000-8000-000000000004', 'pro', 'blocked', now() + interval '5 days');
  INSERT INTO sms_balance (shop_id, monthly_limit, remaining) VALUES ('aaaaaaaa-0000-4000-8000-000000000004', 200, 200);

  -- NO SUBSCRIPTION ROW AT ALL (treated as expired by enforceSubscription)
  INSERT INTO shops (id, owner_id, name) VALUES ('aaaaaaaa-0000-4000-8000-000000000003', 'owner-3', 'Orphan Market');
  INSERT INTO sms_balance (shop_id, monthly_limit, remaining) VALUES ('aaaaaaaa-0000-4000-8000-000000000003', 30, 30);
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
const { config } = await import('../src/config/index.js');

const app = createApp();
const server = createServer(app);
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const tokenFor = (sub, role) =>
  jwt.sign({ sub, role }, config.jwt.accessSecret, { expiresIn: '1h' });
const adminToken = tokenFor('admin-1', 'super_admin');
const ownerToken = tokenFor('owner-1', 'shop_owner');

const call = async (path, opts = {}) => {
  const res = await fetch(base + path, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.token || adminToken}`,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let j; try { j = await res.json(); } catch { j = {}; }
  return { status: res.status, body: j };
};

const one = (sql) => mem.public.many(sql)[0];
const daysBetween = (a, b) => Math.round((new Date(a) - new Date(b)) / 86400000);

let failures = 0;
const P = (n, c, extra = '') => {
  if (!c) failures++;
  console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (extra ? ' :: ' + extra : ''));
};

const extend = (shopId, body, token) =>
  call(`/api/admin/shops/${shopId}/subscription`, { method: 'PATCH', body, token });

// ---------- Access control ----------
console.log('--- access ---');
let r = await extend('aaaaaaaa-0000-4000-8000-000000000001', { months: 1, amountUzs: 50000 }, ownerToken);
P('shop_owner cannot extend a subscription', r.status === 403, `got ${r.status}`);

r = await call('/api/admin/shops/aaaaaaaa-0000-4000-8000-000000000001/subscription-payments', { token: ownerToken });
P('shop_owner cannot read payment history', r.status === 403, `got ${r.status}`);

// ---------- A lapsed subscription is revived from today ----------
console.log('--- lapsed shop ---');
r = await extend('aaaaaaaa-0000-4000-8000-000000000001', { months: 1, amountUzs: 50000, note: 'Naqd, do\'konda' });
P('extend -> 200', r.status === 200, JSON.stringify(r.body));

let sub = one("SELECT * FROM subscriptions WHERE shop_id = 'aaaaaaaa-0000-4000-8000-000000000001'");
P('status becomes active', sub.status === 'active', sub.status);
P('plan unchanged when omitted', sub.plan === 'start', sub.plan);
// Revived from today, NOT from the expiry 30 days ago — otherwise a shop that
// lapsed months ago would be credited for the whole gap.
P('ends_at is ~1 month from now', daysBetween(sub.ends_at, new Date()) >= 28 &&
  daysBetween(sub.ends_at, new Date()) <= 31, `${sub.ends_at}`);

let pay = one("SELECT * FROM subscription_payments WHERE shop_id = 'aaaaaaaa-0000-4000-8000-000000000001'");
P('payment recorded', Number(pay.amount_uzs) === 50000, pay.amount_uzs);
P('payment records the plan sold', pay.plan === 'start', pay.plan);
P('payment records the month count', pay.months === 1, String(pay.months));
P('payment records the note', pay.note === 'Naqd, do\'konda', pay.note);
P('payment records which admin entered it', pay.recorded_by === 'admin-1', pay.recorded_by);
P('payment method is manual', pay.method === 'manual', pay.method);

const log = one("SELECT * FROM audit_logs WHERE action = 'extend_subscription'");
P('audit log written', !!log && log.actor_id === 'admin-1');

// ---------- Early renewal keeps the days already paid for ----------
console.log('--- early renewal ---');
const before = one("SELECT ends_at FROM subscriptions WHERE shop_id = 'aaaaaaaa-0000-4000-8000-000000000002'").ends_at;
r = await extend('aaaaaaaa-0000-4000-8000-000000000002', { months: 1, amountUzs: 150000 });
P('extend -> 200', r.status === 200, JSON.stringify(r.body));

sub = one("SELECT * FROM subscriptions WHERE shop_id = 'aaaaaaaa-0000-4000-8000-000000000002'");
// 20 days remaining + 1 month, so ~50 days out. Extending from `now` instead
// would silently confiscate the 20 days the shop had already bought.
P('extends from the existing expiry, not from today',
  daysBetween(sub.ends_at, new Date()) >= 48, `${daysBetween(sub.ends_at, new Date())} days`);
P('new expiry is later than the old one', new Date(sub.ends_at) > new Date(before));

pay = one("SELECT * FROM subscription_payments WHERE shop_id = 'aaaaaaaa-0000-4000-8000-000000000002'");
P('period_start is the old expiry, not today',
  Math.abs(new Date(pay.period_start) - new Date(before)) < 2000, `${pay.period_start}`);

// ---------- Plan upgrade adjusts the SMS quota ----------
console.log('--- plan upgrade ---');
let sms = one("SELECT * FROM sms_balance WHERE shop_id = 'aaaaaaaa-0000-4000-8000-000000000001'");
P('precondition: start plan, 30 limit / 12 remaining',
  sms.monthly_limit === 30 && sms.remaining === 12);

r = await extend('aaaaaaaa-0000-4000-8000-000000000001', { plan: 'pro', months: 3, amountUzs: 450000 });
P('upgrade -> 200', r.status === 200, JSON.stringify(r.body));

sub = one("SELECT * FROM subscriptions WHERE shop_id = 'aaaaaaaa-0000-4000-8000-000000000001'");
P('plan is upgraded', sub.plan === 'pro', sub.plan);

sms = one("SELECT * FROM sms_balance WHERE shop_id = 'aaaaaaaa-0000-4000-8000-000000000001'");
// The monthly reset copies monthly_limit into remaining, so leaving the limit
// behind would keep an upgraded shop on the old allowance indefinitely.
P('monthly_limit follows the new plan', sms.monthly_limit === 200, String(sms.monthly_limit));
// Credited immediately: a shop paying for Pro today expects Pro today.
P('remaining is credited by the increase (12 + 170)', sms.remaining === 182, String(sms.remaining));

pay = one("SELECT * FROM subscription_payments WHERE shop_id = 'aaaaaaaa-0000-4000-8000-000000000001' ORDER BY created_at DESC");
P('payment records the upgraded plan', pay.plan === 'pro', pay.plan);
P('payment records 3 months', pay.months === 3, String(pay.months));

// ---------- Downgrade must not claw back messages already granted ----------
console.log('--- plan downgrade ---');
r = await extend('aaaaaaaa-0000-4000-8000-000000000001', { plan: 'start', months: 1, amountUzs: 50000 });
P('downgrade -> 200', r.status === 200);
sms = one("SELECT * FROM sms_balance WHERE shop_id = 'aaaaaaaa-0000-4000-8000-000000000001'");
P('monthly_limit drops to the new plan', sms.monthly_limit === 30, String(sms.monthly_limit));
P('remaining is NOT clawed back mid-month', sms.remaining === 182, String(sms.remaining));

// ---------- A shop with no subscription row ----------
console.log('--- missing subscription row ---');
r = await extend('aaaaaaaa-0000-4000-8000-000000000003', { plan: 'business', months: 6, amountUzs: 1800000 });
P('extend -> 200', r.status === 200, JSON.stringify(r.body));
sub = one("SELECT * FROM subscriptions WHERE shop_id = 'aaaaaaaa-0000-4000-8000-000000000003'");
P('a subscription row is created', !!sub);
P('created row is active on the paid plan', sub && sub.status === 'active' && sub.plan === 'business');
P('created row runs ~6 months', sub && daysBetween(sub.ends_at, new Date()) >= 178,
  sub ? `${daysBetween(sub.ends_at, new Date())} days` : 'no row');

// ---------- Validation ----------
console.log('--- validation ---');
const beforeCount = Number(one('SELECT COUNT(*) AS c FROM subscription_payments').c);

r = await extend('aaaaaaaa-0000-4000-8000-000000000002', { months: 0, amountUzs: 1000 });
P('0 months rejected', r.status === 422, `got ${r.status}`);
r = await extend('aaaaaaaa-0000-4000-8000-000000000002', { months: 25, amountUzs: 1000 });
P('25 months rejected', r.status === 422, `got ${r.status}`);
r = await extend('aaaaaaaa-0000-4000-8000-000000000002', { months: 1, amountUzs: -5 });
P('negative amount rejected', r.status === 422, `got ${r.status}`);
r = await extend('aaaaaaaa-0000-4000-8000-000000000002', { months: 1.5, amountUzs: 1000 });
P('fractional months rejected', r.status === 422, `got ${r.status}`);
r = await extend('aaaaaaaa-0000-4000-8000-000000000002', { months: 1, amountUzs: 1000, plan: 'platinum' });
P('unknown plan rejected', r.status === 422, `got ${r.status}`);
r = await extend('aaaaaaaa-0000-4000-8000-000000000002', { amountUzs: 1000 });
P('missing months rejected', r.status === 422, `got ${r.status}`);
r = await extend('not-a-uuid', { months: 1, amountUzs: 1000 });
P('non-uuid shop id rejected', r.status === 422, `got ${r.status}`);

P('no rejected request wrote a payment row',
  Number(one('SELECT COUNT(*) AS c FROM subscription_payments').c) === beforeCount);

// A comped extension is legitimate and must still be recorded.
r = await extend('aaaaaaaa-0000-4000-8000-000000000002', { months: 1, amountUzs: 0, note: 'Uzr uchun bepul' });
P('zero amount accepted (comped)', r.status === 200, `got ${r.status}`);

// ---------- Unknown shop ----------
r = await extend('11111111-1111-1111-1111-111111111111', { months: 1, amountUzs: 1000 });
P('unknown shop -> 404', r.status === 404, `got ${r.status}`);
// The transaction must roll back cleanly rather than leaving a partial write.
P('unknown shop wrote no payment row',
  Number(one("SELECT COUNT(*) AS c FROM subscription_payments WHERE shop_id = '11111111-1111-1111-1111-111111111111'").c) === 0);

// ---------- History ----------
console.log('--- history ---');
r = await call('/api/admin/shops/aaaaaaaa-0000-4000-8000-000000000001/subscription-payments');
P('history -> 200', r.status === 200, `got ${r.status}`);
P('history returns every payment for the shop', Array.isArray(r.body) && r.body.length === 3,
  `got ${r.body.length}`);
P('history is newest first',
  new Date(r.body[0].created_at) >= new Date(r.body[r.body.length - 1].created_at));
P('history names the admin who recorded it', r.body[0].recorded_by_phone === '+998900000000',
  r.body[0].recorded_by_phone);

// ---------- Stats ----------
console.log('--- stats ---');
// ---------- Moderation state survives a renewal ----------
console.log('--- blocked shop ---');

// THE BUG: extend forced status = 'active', so recording a routine payment for
// a shop that had been blocked for abuse silently lifted the block — with no
// audit trail saying anyone had decided to. setShopActive is the moderation
// lever; taking money is not.
r = await extend('aaaaaaaa-0000-4000-8000-000000000004', { months: 3, amountUzs: 450000 });
P('extending a blocked shop -> 200', r.status === 200, JSON.stringify(r.body));

sub = one("SELECT * FROM subscriptions WHERE shop_id = 'aaaaaaaa-0000-4000-8000-000000000004'");
P('the block is NOT lifted by paying', sub.status === 'blocked', sub.status);
// The money and the period still have to be honoured — they paid for it.
P('but the period is still extended', new Date(sub.ends_at) > new Date(Date.now() + 90 * 86400000), String(sub.ends_at));

let blockedPay = one("SELECT * FROM subscription_payments WHERE shop_id = 'aaaaaaaa-0000-4000-8000-000000000004'");
P('and the payment is recorded', Number(blockedPay.amount_uzs) === 450000, String(blockedPay?.amount_uzs));

// ---------- Month-end arithmetic ----------
console.log('--- month-end dates ---');

// THE BUG: setMonth(getMonth() + n) overflows a short month — Jan 31 + 1 month
// landed on Mar 3, handing out three free days and writing the wrong date into
// the immutable payment record too.
// Imported, not re-implemented: a local copy would keep passing after the real
// one regressed, which is the one thing these assertions exist to catch.
const { addMonths } = await import('../src/controllers/admin.controller.js');
const iso = (d) => d.toISOString().slice(0, 10);
P('Jan 31 + 1 month clamps to Feb 28', iso(addMonths(new Date('2026-01-31T12:00:00Z'), 1)) === '2026-02-28', iso(addMonths(new Date('2026-01-31T12:00:00Z'), 1)));
P('and to Feb 29 in a leap year', iso(addMonths(new Date('2024-01-31T12:00:00Z'), 1)) === '2024-02-29', iso(addMonths(new Date('2024-01-31T12:00:00Z'), 1)));
P('Aug 31 + 6 months clamps too', iso(addMonths(new Date('2026-08-31T12:00:00Z'), 6)) === '2027-02-28', iso(addMonths(new Date('2026-08-31T12:00:00Z'), 6)));
P('an ordinary date is untouched', iso(addMonths(new Date('2026-01-15T12:00:00Z'), 1)) === '2026-02-15');

r = await call('/api/admin/stats');
P('stats -> 200', r.status === 200, `got ${r.status}`);
P('collectedThisMonth reports money actually received',
  r.body.collectedThisMonth === 50000 + 450000 + 50000 + 1800000 + 150000 + 0 + 450000,
  String(r.body.collectedThisMonth));

server.close();
if (failures) process.exit(1);
