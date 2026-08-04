// Verifies GET /api/debtors correctly splits outstanding by direction for a
// personal user with mixed given/taken debts, and that shop-owner behavior
// (always 'given') is unaffected.
import { createServer } from 'http';
import jwt from 'jsonwebtoken';

const { default: pgMod } = await import('pg');

const debts = [
  // debtor-1 (personal owner's contact): mixed directions
  { id: 'dt1', debtor_id: 'debtor-1', amount: 500000, paid_amount: 0, status: 'open', direction: 'given' },
  { id: 'dt2', debtor_id: 'debtor-1', amount: 200000, paid_amount: 50000, status: 'partial', direction: 'taken' },
  { id: 'dt3', debtor_id: 'debtor-1', amount: 90000, paid_amount: 90000, status: 'paid', direction: 'given' }, // paid: excluded
  // debtor-2 (shop's customer): only ever 'given'
  { id: 'dt4', debtor_id: 'debtor-2', amount: 300000, paid_amount: 100000, status: 'partial', direction: 'given' },
];
const debtors = [
  { id: 'debtor-1', owner_id: 'personal-1', shop_id: null, full_name: 'Aziz Do\'st', phone: '+998901111111', telegram_id: null, is_archived: false, created_at: new Date() },
  { id: 'debtor-2', owner_id: null, shop_id: 'shop-1', full_name: 'Shop Customer', phone: '+998902222222', telegram_id: null, is_archived: false, created_at: new Date() },
];

pgMod.Pool.prototype.query = async function (text, params = []) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (t.includes('FROM users u') && t.includes('LEFT JOIN shops')) {
    const id = params[0];
    if (id === 'personal-1') return { rows: [{ id: 'personal-1', role: 'personal', is_active: true, parent_shop_id: null }] };
    if (id === 'owner-1') return { rows: [{ id: 'owner-1', role: 'shop_owner', is_active: true, parent_shop_id: null, owned_shop_id: 'shop-1' }] };
    return { rows: [] };
  }
  if (t.startsWith('SELECT id FROM shops WHERE owner_id')) return { rows: [{ id: 'shop-1' }] };

  // emulate the actual listDebtors SQL: filter by scope, join debts, aggregate
  if (t.includes('FROM debtors d') && t.includes('LEFT JOIN debts dt')) {
    const scopeField = t.includes('d.owner_id') ? 'owner_id' : 'shop_id';
    const scopeValue = params[0];
    const scoped = debtors.filter((d) => d[scopeField] === scopeValue && !d.is_archived);
    const result = scoped.map((d) => {
      const own = debts.filter((x) => x.debtor_id === d.id);
      const outstanding = own.reduce((s, x) => s + (x.status !== 'paid' ? x.amount - x.paid_amount : 0), 0);
      const outstanding_given = own.reduce((s, x) => s + (x.status !== 'paid' && x.direction === 'given' ? x.amount - x.paid_amount : 0), 0);
      const outstanding_taken = own.reduce((s, x) => s + (x.status !== 'paid' && x.direction === 'taken' ? x.amount - x.paid_amount : 0), 0);
      return { ...d, outstanding, outstanding_given, outstanding_taken, debt_count: own.length };
    });
    return { rows: result };
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

const personalToken = jwt.sign({ sub: 'personal-1', role: 'personal' }, config.jwt.accessSecret, { expiresIn: '1h' });
const ownerToken = jwt.sign({ sub: 'owner-1', role: 'shop_owner' }, config.jwt.accessSecret, { expiresIn: '1h' });

const get = async (path, token) => {
  const res = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json() };
};
const P = (n, c, extra = '') => console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (extra ? ' :: ' + extra : ''));

console.log('--- direction-split outstanding (personal user, mixed debts) ---');
let r = await get('/api/debtors', personalToken);
const row = r.body[0];
P('debtor found', !!row, JSON.stringify(r.body));
P('outstanding_given = 500000 (dt1 only; dt3 excluded as paid)', Number(row.outstanding_given) === 500000, `got ${row.outstanding_given}`);
P('outstanding_taken = 150000 (dt2: 200000-50000)', Number(row.outstanding_taken) === 150000, `got ${row.outstanding_taken}`);
P('net outstanding = 650000 (given+taken, backward compat)', Number(row.outstanding) === 650000, `got ${row.outstanding}`);
P('debt_count includes the paid one too (3)', Number(row.debt_count) === 3, `got ${row.debt_count}`);

console.log('\n--- shop owner (only ever \'given\', unaffected by the change) ---');
r = await get('/api/debtors', ownerToken);
const orow = r.body[0];
P('shop debtor found', !!orow);
P('outstanding_given = 200000 (300000-100000)', Number(orow.outstanding_given) === 200000, `got ${orow.outstanding_given}`);
P('outstanding_taken = 0 (shop never records taken)', Number(orow.outstanding_taken) === 0, `got ${orow.outstanding_taken}`);
P('net outstanding matches outstanding_given exactly', Number(orow.outstanding) === Number(orow.outstanding_given));

server.close();
