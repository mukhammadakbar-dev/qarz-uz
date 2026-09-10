// Correcting and removing a debt.
//
// THE GAP: /debts had only POST. A shop owner who typed 500 000 instead of
// 50 000 could not fix it and could not remove it — the only way to make the
// entry go away was to record a payment that never happened, which then put a
// lie in the payment ledger too.
//
// The subtle half is daily_sales. createDebt adds every 'given' debt to that
// day's `debt_given` rollup, and nothing ever subtracted it, so a correction
// that only touched `debts` would leave the shop's turnover reporting
// permanently overstated. These tests follow the money through both tables.
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
    parent_shop_id TEXT, is_active BOOLEAN NOT NULL DEFAULT TRUE
  );
  CREATE TABLE shops (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL);
  CREATE TABLE subscriptions (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(), shop_id TEXT NOT NULL,
    plan TEXT NOT NULL, status TEXT NOT NULL, ends_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE debtors (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(), owner_id TEXT, shop_id TEXT,
    full_name TEXT NOT NULL, phone TEXT, telegram_id BIGINT,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE debts (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    debtor_id TEXT NOT NULL, shop_id TEXT, direction TEXT NOT NULL DEFAULT 'given',
    amount NUMERIC(14,2) NOT NULL, paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    note TEXT, issued_at DATE NOT NULL DEFAULT CURRENT_DATE, due_date DATE,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE payments (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(), debt_id TEXT NOT NULL,
    amount NUMERIC(14,2) NOT NULL, method TEXT NOT NULL DEFAULT 'manual',
    transaction_id TEXT, paid_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE daily_sales (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(), shop_id TEXT NOT NULL,
    sale_date DATE NOT NULL, cash_card NUMERIC(14,2) NOT NULL DEFAULT 0,
    debt_given NUMERIC(14,2) NOT NULL DEFAULT 0, total NUMERIC(14,2) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX uq_daily ON daily_sales (shop_id, sale_date);

  INSERT INTO users (id, role, phone) VALUES ('owner-1', 'shop_owner', '+998901111111');
  INSERT INTO shops (id, owner_id, name) VALUES ('shop-1', 'owner-1', 'Test Market');
  INSERT INTO subscriptions (shop_id, plan, status, ends_at)
    VALUES ('shop-1', 'start', 'active', now() + interval '30 days');
  INSERT INTO debtors (id, shop_id, full_name) VALUES ('11111111-1111-4111-8111-111111111111', 'shop-1', 'Ali');
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
const token = jwt.sign({ sub: 'owner-1', role: 'shop_owner' }, config.jwt.accessSecret, { expiresIn: '1h' });

const P = (n, c, extra) => console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (extra ? ' :: ' + extra : ''));
const call = async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const rollup = async () => {
  const { rows } = await memPool.query('SELECT debt_given, total FROM daily_sales WHERE shop_id = $1', ['shop-1']);
  return rows[0] ? { given: Number(rows[0].debt_given), total: Number(rows[0].total) } : null;
};

// ---------------------------------------------------------------------------
console.log('--- correcting a mistyped amount ---');

let r = await call('POST', '/api/debts', { debtorId: '11111111-1111-4111-8111-111111111111', amount: 500000 });
P('debt created', r.status === 201, String(r.status));
const debtId = r.body.id;
P('daily rollup counted it', (await rollup())?.given === 500000, JSON.stringify(await rollup()));

// The whole point: 500 000 was a typo for 50 000.
r = await call('PATCH', `/api/debts/${debtId}`, { amount: 50000 });
P('amount can be corrected', r.status === 200 && Number(r.body.amount) === 50000, String(r.status));

const after = await rollup();
P('daily rollup follows the correction', after?.given === 50000, JSON.stringify(after));
P('and its total is recomputed', after?.total === 50000, String(after?.total));

// ---------------------------------------------------------------------------
console.log('\n--- what a correction must refuse ---');

await call('POST', `/api/debts/${debtId}/payments`, { amount: 30000, method: 'cash' });

r = await call('PATCH', `/api/debts/${debtId}`, { amount: 20000 });
P('cannot drop below what was paid', r.status === 422 && r.body.error?.code === 'BELOW_PAID', r.body.error?.code);
P('the rollup was not touched by the refusal', (await rollup())?.given === 50000);

// Paying 30 000 of 50 000 leaves it partial; correcting the total to exactly
// what was paid must close it.
r = await call('PATCH', `/api/debts/${debtId}`, { amount: 30000 });
P('status is recomputed from the new amount', r.body.status === 'paid', r.body.status);

r = await call('DELETE', `/api/debts/${debtId}`);
P('a debt with payments cannot be deleted', r.status === 409 && r.body.error?.code === 'HAS_PAYMENTS', r.body.error?.code);

// ---------------------------------------------------------------------------
console.log('\n--- deleting an entry made by mistake ---');

const before = (await rollup()).given;
r = await call('POST', '/api/debts', { debtorId: '11111111-1111-4111-8111-111111111111', amount: 77000 });
const strayId = r.body.id;
P('rollup includes the stray debt', (await rollup()).given === before + 77000);

r = await call('DELETE', `/api/debts/${strayId}`);
P('an unpaid debt can be deleted', r.status === 200, String(r.status));
P('rollup is back where it was', (await rollup()).given === before, String((await rollup()).given));

const gone = await memPool.query('SELECT 1 FROM debts WHERE id = $1', [strayId]);
P('the row is really gone', gone.rows.length === 0);

// ---------------------------------------------------------------------------
console.log('\n--- and what another tenant may not do ---');

await memPool.query(
  `INSERT INTO users (id, role, phone) VALUES ('owner-2', 'shop_owner', '+998902222222')`
);
await memPool.query(`INSERT INTO shops (id, owner_id, name) VALUES ('shop-2', 'owner-2', 'Other')`);
await memPool.query(
  `INSERT INTO subscriptions (shop_id, plan, status, ends_at)
   VALUES ('shop-2', 'start', 'active', now() + interval '30 days')`
);
const otherToken = jwt.sign({ sub: 'owner-2', role: 'shop_owner' }, config.jwt.accessSecret, { expiresIn: '1h' });
const asOther = async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${otherToken}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.status;
};

P('another shop cannot edit this debt', (await asOther('PATCH', `/api/debts/${debtId}`, { amount: 1 })) === 404);
P('another shop cannot delete it', (await asOther('DELETE', `/api/debts/${debtId}`)) === 404);

// An empty body would otherwise mean "update nothing", quietly returning 200.
r = await call('PATCH', `/api/debts/${debtId}`, {});
P('an empty update is rejected', r.status === 422 || r.status === 400, String(r.status));

server.close();
