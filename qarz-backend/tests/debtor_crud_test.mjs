// Exercises PATCH/DELETE /api/debtors/:id against the real Express app with a
// stateful pg stub. Covers the case the task explicitly called out: deleting
// (archiving) a debtor who still has an open debt must be refused (409).
import { createServer } from 'http';
import jwt from 'jsonwebtoken';

const { default: pgMod } = await import('pg');

// --- stateful stub ---
const db = {
  debtors: [
    // shop A's debtor, no open debts -> archivable
    { id: '11111111-1111-4111-8111-111111111111', shop_id: 'shop-A', owner_id: null, full_name: 'Akmal Yusupov', phone: '+998901234567', telegram_id: null, is_archived: false },
    // shop A's debtor, has an open debt -> must be refused
    { id: '22222222-2222-4222-8222-222222222222', shop_id: 'shop-A', owner_id: null, full_name: 'Dilnoza Karimova', phone: '+998935556677', telegram_id: null, is_archived: false },
    // shop B's debtor -> must be invisible to shop A's owner
    { id: '33333333-3333-4333-8333-333333333333', shop_id: 'shop-B', owner_id: null, full_name: 'Boshqa Dokon Mijozi', phone: '+998977778899', telegram_id: null, is_archived: false },
  ],
  debts: [
    { id: 'debt-1', debtor_id: '22222222-2222-4222-8222-222222222222', amount: 100000, paid_amount: 0, status: 'open' },
  ],
};

pgMod.Pool.prototype.query = async function (text, params = []) {
  const t = String(text).replace(/\s+/g, ' ').trim();

  // authenticate() middleware loads the user
  if (t.includes('FROM users u') && t.includes('LEFT JOIN shops')) {
    return { rows: [{ id: 'owner-A', role: 'shop_owner', is_active: true, parent_shop_id: null, owned_shop_id: 'shop-A' }] };
  }
  if (t.startsWith('SELECT id FROM shops WHERE owner_id')) {
    return { rows: [{ id: 'shop-A' }] };
  }
  // enforceSubscription middleware
  if (t.includes('FROM subscriptions') && t.includes('ORDER BY created_at DESC LIMIT 1')) {
    return { rows: [{ status: 'active', ends_at: new Date(Date.now() + 999 * 864e5) }] };
  }

  // SELECT debtor by id + shop scope
  if (t.startsWith('SELECT * FROM debtors WHERE id = $1 AND')) {
    const scoped = db.debtors.find((d) => d.id === params[0] && (d.shop_id === params[1] || d.owner_id === params[1]));
    return { rows: scoped ? [scoped] : [] };
  }

  // open-debts check
  if (t.includes('FROM debts WHERE debtor_id')) {
    const open = db.debts.filter((x) => x.debtor_id === params[0] && x.status !== 'paid');
    const outstanding = open.reduce((s, x) => s + (x.amount - x.paid_amount), 0);
    return { rows: [{ outstanding, cnt: open.length }] };
  }

  // UPDATE ... archive
  if (t.startsWith('UPDATE debtors SET is_archived')) {
    const d = db.debtors.find((x) => x.id === params[0] && (x.shop_id === params[1] || x.owner_id === params[1]));
    if (!d) return { rows: [] };
    d.is_archived = true;
    return { rows: [{ id: d.id, full_name: d.full_name, is_archived: true }] };
  }

  // UPDATE ... (generic field update from updateDebtor)
  if (t.startsWith('UPDATE debtors SET') && !t.includes('is_archived')) {
    const d = db.debtors.find((x) => x.id === params[0]);
    if (!d) return { rows: [] };
    // Just reflect whatever the test asserts on via full_name param directly
    if (params[2] !== undefined) d.full_name = params[2];
    return { rows: [d] };
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

const token = jwt.sign({ sub: 'owner-A', role: 'shop_owner' }, config.jwt.accessSecret, { expiresIn: '1h' });

const call = async (path, opts = {}) => {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) };
  const res = await fetch(base + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let j; try { j = await res.json(); } catch { j = {}; }
  return { status: res.status, body: j };
};
const P = (n, c, extra = '') => console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (extra ? ' :: ' + extra : ''));

console.log('--- #3 archive / delete debtor ---');

// 1. Debtor with NO open debts can be archived
let r = await call('/api/debtors/11111111-1111-4111-8111-111111111111', { method: 'DELETE' });
P('archivable debtor -> 200', r.status === 200, `got ${r.status} ${JSON.stringify(r.body)}`);
P('response marks archived', r.body.archived === true);
P('debtor actually flagged archived in store', db.debtors.find((d) => d.id === '11111111-1111-4111-8111-111111111111').is_archived === true);

// 2. Debtor WITH an open debt must be refused — the case the task called out explicitly
r = await call('/api/debtors/22222222-2222-4222-8222-222222222222', { method: 'DELETE' });
P('debtor with open debt -> 409 HAS_OPEN_DEBTS', r.status === 409 && r.body?.error?.code === 'HAS_OPEN_DEBTS', `got ${r.status} ${r.body?.error?.code}`);
P('22222222-2222-4222-8222-222222222222 NOT archived after refusal', db.debtors.find((d) => d.id === '22222222-2222-4222-8222-222222222222').is_archived === false);
P('error message mentions the debt', /qarz/i.test(r.body?.error?.message || ''));

// 3. Tenant scoping: shop A's owner cannot touch shop B's debtor
r = await call('/api/debtors/33333333-3333-4333-8333-333333333333', { method: 'DELETE' });
P('other shop\'s debtor -> 404 (not found, not leaked)', r.status === 404, `got ${r.status}`);
P('33333333-3333-4333-8333-333333333333 untouched', db.debtors.find((d) => d.id === '33333333-3333-4333-8333-333333333333').is_archived === false);

// 4. Unknown id -> 404
r = await call('/api/debtors/99999999-9999-4999-8999-999999999999', { method: 'DELETE' });
P('unknown debtor id -> 404', r.status === 404, `got ${r.status}`);

console.log('\n--- PATCH /api/debtors/:id ---');

// 5. Update own debtor's name
r = await call('/api/debtors/11111111-1111-4111-8111-111111111111', { method: 'PATCH', body: { fullName: 'Akmal Yangi' } });
P('update own debtor -> 200', r.status === 200, `got ${r.status} ${JSON.stringify(r.body)}`);

// 6. Cannot update another shop's debtor
r = await call('/api/debtors/33333333-3333-4333-8333-333333333333', { method: 'PATCH', body: { fullName: 'Hack Attempt' } });
P('update other shop\'s debtor -> 404', r.status === 404, `got ${r.status}`);
P('33333333-3333-4333-8333-333333333333 name unchanged', db.debtors.find((d) => d.id === '33333333-3333-4333-8333-333333333333').full_name === 'Boshqa Dokon Mijozi');

// 7. No auth -> 401 for both verbs
const noAuth = await fetch(base + '/api/debtors/11111111-1111-4111-8111-111111111111', { method: 'DELETE' });
P('DELETE without auth -> 401', noAuth.status === 401, `got ${noAuth.status}`);
const noAuth2 = await fetch(base + '/api/debtors/11111111-1111-4111-8111-111111111111', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' });
P('PATCH without auth -> 401', noAuth2.status === 401, `got ${noAuth2.status}`);

server.close();
