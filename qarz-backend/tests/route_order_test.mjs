// Regression test for a critical bug: because debtRoutes was mounted at the
// generic '/api' prefix BEFORE the more specific '/api/shop' and '/api/admin'
// prefixes, every request under those paths first passed through debtRoutes'
// own `authorize('shop_owner','staff','personal')` gate. Shop owners/staff
// passed that gate harmlessly (no matching route, so Express fell through to
// the real handler) — but super_admin was hard-rejected with 403 before ever
// reaching adminRoutes. This silently broke 100% of the Super Admin panel's
// backend, undetected because no test had exercised it over real HTTP before.
//
// This test pins the correct behavior so the mount order can never regress
// silently again.
import { createServer } from 'http';
import jwt from 'jsonwebtoken';

const { default: pgMod } = await import('pg');

pgMod.Pool.prototype.query = async function (text, params = []) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (t.startsWith('SELECT id, role, is_active, parent_shop_id FROM users')) {
    const id = params[0];
    if (id === 'sa1') return { rows: [{ id: 'sa1', role: 'super_admin', is_active: true, parent_shop_id: null }] };
    if (id === 'owner1') return { rows: [{ id: 'owner1', role: 'shop_owner', is_active: true, parent_shop_id: null }] };
    return { rows: [] };
  }
  if (t.startsWith('SELECT id FROM shops WHERE owner_id')) return { rows: [{ id: 'shop-1' }] };
  // aggregate COUNT/SUM queries used by platformStats and the shop dashboard
  if (/^SELECT\s+(COALESCE\()?COUNT|^SELECT\s+COALESCE\(SUM/i.test(t)) {
    return { rows: [{ c: 0, total: 0 }] };
  }
  // generic empty-set responses are fine for every other query these
  // endpoints happen to run — we only care about the HTTP status here
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

const saToken = jwt.sign({ sub: 'sa1', role: 'super_admin' }, config.jwt.accessSecret, { expiresIn: '1h' });
const ownerToken = jwt.sign({ sub: 'owner1', role: 'shop_owner' }, config.jwt.accessSecret, { expiresIn: '1h' });

const get = async (path, token) => {
  const res = await fetch(base + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return res.status;
};
const P = (n, c, extra = '') => console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (extra ? ' :: ' + extra : ''));

console.log('--- route mount order: /api/admin/* must be reachable by super_admin ---');

for (const path of ['/api/admin/shops', '/api/admin/plans', '/api/admin/audit-log']) {
  const status = await get(path, saToken);
  P(`super_admin GET ${path} -> 200 (not 403)`, status === 200, `got ${status}`);
}

// stats does its own aggregate queries our generic stub answers as empty rows,
// which is enough to prove routing reaches the handler at all (no 403/404).
const statsStatus = await get('/api/admin/stats', saToken);
P('super_admin GET /api/admin/stats reaches handler (not 403/404)', statsStatus !== 403 && statsStatus !== 404, `got ${statsStatus}`);

console.log('\n--- /api/admin/* must still be OFF-LIMITS to shop_owner ---');
for (const path of ['/api/admin/shops', '/api/admin/plans', '/api/admin/audit-log']) {
  const status = await get(path, ownerToken);
  P(`shop_owner GET ${path} -> 403`, status === 403, `got ${status}`);
}

console.log('\n--- /api/shop/* must still work for shop_owner (sanity: fix didn\'t break the normal path) ---');
const dashStatus = await get('/api/shop/dashboard', ownerToken);
P('shop_owner GET /api/shop/dashboard reaches handler (not 403/404)', dashStatus !== 403 && dashStatus !== 404, `got ${dashStatus}`);

console.log('\n--- /api/debtors must still work for shop_owner (the original, broadest mount) ---');
const debtorsStatus = await get('/api/debtors', ownerToken);
P('shop_owner GET /api/debtors reaches handler (not 403/404)', debtorsStatus !== 403 && debtorsStatus !== 404, `got ${debtorsStatus}`);

server.close();
