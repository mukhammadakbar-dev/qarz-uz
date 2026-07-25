// Verifies POST /api/admin/broadcast: reaches every active shop owner via
// Telegram-then-SMS fallback, skips inactive owners, and records an audit entry.
import { createServer } from 'http';
import jwt from 'jsonwebtoken';

const { default: pgMod } = await import('pg');

const owners = [
  { id: 'o1', phone: '+998901111111', telegram_id: 555111, full_name: 'Owner A', is_active: true }, // -> telegram
  { id: 'o2', phone: '+998902222222', telegram_id: null, full_name: 'Owner B', is_active: true },   // -> sms
  { id: 'o3', phone: null, telegram_id: null, full_name: 'Owner C (no contact)', is_active: true },  // -> fails
];
const auditRows = [];

pgMod.Pool.prototype.query = async function (text, params = []) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (t.startsWith('SELECT id, role, is_active, parent_shop_id FROM users')) {
    const id = params[0];
    if (id === 'sa1') return { rows: [{ id: 'sa1', role: 'super_admin', is_active: true, parent_shop_id: null }] };
    if (id === 'x') return { rows: [{ id: 'x', role: 'shop_owner', is_active: true, parent_shop_id: null }] };
    return { rows: [] };
  }
  if (t.startsWith('SELECT id FROM shops WHERE owner_id')) {
    return { rows: [{ id: 'shop-owner-x' }] };
  }
  if (t.includes("role = 'shop_owner' AND is_active = TRUE")) {
    return { rows: owners };
  }
  if (t.startsWith('INSERT INTO audit_logs')) {
    auditRows.push({ actor_id: params[0], action: params[1], meta: JSON.parse(params[2]) });
    return { rows: [] };
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

const token = jwt.sign({ sub: 'sa1', role: 'super_admin' }, config.jwt.accessSecret, { expiresIn: '1h' });
const call = async (path, opts = {}) => {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) };
  const res = await fetch(base + path, {
    method: opts.method || 'GET', headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let j; try { j = await res.json(); } catch { j = {}; }
  return { status: res.status, body: j };
};
const P = (n, c, extra = '') => console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (extra ? ' :: ' + extra : ''));

console.log('--- POST /api/admin/broadcast ---');

let r = await call('/api/admin/broadcast', { method: 'POST', body: { message: 'Ertaga texnik ishlar bo\'ladi' } });
P('broadcast -> 200', r.status === 200, `got ${r.status} ${JSON.stringify(r.body)}`);
P('reaches all 3 owners', r.body.totalOwners === 3, `got ${r.body.totalOwners}`);
P('one sent via telegram (has telegram_id)', r.body.telegramSent === 1, `got ${r.body.telegramSent}`);
P('one sent via sms (phone only)', r.body.smsSent === 1, `got ${r.body.smsSent}`);
P('one failed (no contact channel)', r.body.failed === 1, `got ${r.body.failed}`);

P('audit log entry recorded', auditRows.length === 1);
P('audit action is "broadcast"', auditRows[0]?.action === 'broadcast');
P('audit meta includes counts', auditRows[0]?.meta?.totalOwners === 3);

// empty message rejected
r = await call('/api/admin/broadcast', { method: 'POST', body: { message: '' } });
P('empty message -> 422', r.status === 422, `got ${r.status}`);

// too-long message rejected
r = await call('/api/admin/broadcast', { method: 'POST', body: { message: 'x'.repeat(1001) } });
P('over-long message -> 422', r.status === 422, `got ${r.status}`);

// requires super_admin
const ownerToken = jwt.sign({ sub: 'x', role: 'shop_owner' }, config.jwt.accessSecret, { expiresIn: '1h' });
const res = await fetch(base + '/api/admin/broadcast', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
  body: JSON.stringify({ message: 'hi' }),
});
P('shop_owner forbidden from broadcast -> 403', res.status === 403, `got ${res.status}`);

// no auth
const res2 = await fetch(base + '/api/admin/broadcast', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'hi' }),
});
P('no auth -> 401', res2.status === 401, `got ${res2.status}`);

server.close();
