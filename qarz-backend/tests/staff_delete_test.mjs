// Proves DELETE /api/shop/staff/:id no longer destroys ledger data.
//
// debtors.owner_id references users(id) ON DELETE CASCADE, and staff-created
// debtors carry the *staff member's* id there. Deleting the employee therefore
// cascaded into debtors -> debts -> payments, silently wiping the shop's
// records for every customer that employee had ever served.
//
// Uses pg-mem so the foreign keys and cascades are real, not stubbed.
import { createServer } from 'http';
import { newDb } from 'pg-mem';
import jwt from 'jsonwebtoken';

const mem = newDb();
mem.public.registerFunction({ name: 'now', returns: 'timestamptz', implementation: () => new Date() });

mem.public.none(`
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    phone TEXT,
    password_hash TEXT,
    full_name TEXT,
    parent_shop_id TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE shops (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL
  );
  CREATE TABLE debtors (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shop_id TEXT REFERENCES shops(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    phone TEXT,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE debts (
    id TEXT PRIMARY KEY,
    debtor_id TEXT NOT NULL REFERENCES debtors(id) ON DELETE CASCADE,
    shop_id TEXT,
    amount NUMERIC(14,2) NOT NULL,
    paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open'
  );

  CREATE TABLE subscriptions (
    id TEXT PRIMARY KEY,
    shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    plan TEXT NOT NULL DEFAULT 'start',
    status TEXT NOT NULL DEFAULT 'active',
    ends_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  INSERT INTO users (id, role, phone) VALUES ('owner-1', 'shop_owner', '+998901111111');
  INSERT INTO shops (id, owner_id, name) VALUES ('shop-A', 'owner-1', 'Diyor Market');
  INSERT INTO subscriptions (id, shop_id, plan, status, ends_at)
    VALUES ('sub-1', 'shop-A', 'pro', 'active', '2099-01-01T00:00:00Z');
  INSERT INTO users (id, role, phone, parent_shop_id) VALUES ('staff-1', 'staff', '+998902222222', 'shop-A');
  INSERT INTO debtors (id, owner_id, shop_id, full_name) VALUES ('debtor-1', 'staff-1', 'shop-A', 'Mijoz A');
  INSERT INTO debtors (id, owner_id, shop_id, full_name) VALUES ('debtor-2', 'owner-1', 'shop-A', 'Mijoz B');
  INSERT INTO debts (id, debtor_id, shop_id, amount) VALUES ('debt-1', 'debtor-1', 'shop-A', 500000);
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
const call = async (path, opts = {}) => {
  const res = await fetch(base + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let j; try { j = await res.json(); } catch { j = {}; }
  return { status: res.status, body: j };
};

const count = (sql) => Number(mem.public.many(sql)[0].c);
let failures = 0;
const P = (n, c, extra = '') => {
  if (!c) failures++;
  console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (extra ? ' :: ' + extra : ''));
};

console.log('--- DELETE /api/shop/staff/:id must not cascade away the ledger ---');
P('precondition: 2 debtors, 1 debt', count('SELECT COUNT(*) AS c FROM debtors') === 2 &&
  count('SELECT COUNT(*) AS c FROM debts') === 1);

let r = await call('/api/shop/staff/staff-1', { method: 'DELETE' });
P('delete staff -> 200', r.status === 200, `got ${r.status} ${JSON.stringify(r.body)}`);
P('staff account is gone', count("SELECT COUNT(*) AS c FROM users WHERE id = 'staff-1'") === 0);

P('BOTH debtors survive', count('SELECT COUNT(*) AS c FROM debtors') === 2,
  `got ${count('SELECT COUNT(*) AS c FROM debtors')}`);
P('the debt survives', count('SELECT COUNT(*) AS c FROM debts') === 1,
  `got ${count('SELECT COUNT(*) AS c FROM debts')}`);
P('staff-created debtor reassigned to the shop owner',
  count("SELECT COUNT(*) AS c FROM debtors WHERE id = 'debtor-1' AND owner_id = 'owner-1'") === 1);
P('response reports the reassignment', r.body.reassignedDebtors === 1, JSON.stringify(r.body));

r = await call('/api/shop/staff/staff-1', { method: 'DELETE' });
P('deleting again -> 404', r.status === 404, `got ${r.status}`);

r = await call('/api/shop/staff/owner-1', { method: 'DELETE' });
P('cannot delete the owner via the staff route -> 404', r.status === 404, `got ${r.status}`);
P('owner still exists', count("SELECT COUNT(*) AS c FROM users WHERE id = 'owner-1'") === 1);

server.close();
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall green');
process.exit(failures ? 1 : 0);
