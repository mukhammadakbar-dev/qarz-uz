import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiHarness, type ApiHarness, type Shop } from '../../test/api-harness.js';

/**
 * T4.6 / AC-06: tenant isolation matritsasi. A biznes foydalanuvchisi B biznes ma'lumotini
 * ko'ra olmaydi, o'zgartira olmaydi, so'rov qila olmaydi. Matritsa `app.registeredRoutes` bilan solishtiriladi:
 * yangi himoyalangan yo'l matritsaga qo'shilmasa test yiqiladi.
 */

interface Ids {
  customerId: string;
  entryId: string;
  staffUserId: string;
}
interface Spec {
  readonly method: 'GET' | 'POST' | 'PATCH';
  /** Fastify yo'l shabloni (registeredRoutes bilan solishtiriladi). */
  readonly pattern: string;
  readonly path: (ids: Ids) => string;
  readonly body?: unknown;
  readonly key?: boolean;
  /** Boshqa biznesning resurs ID sini oladimi (resurs hujumi 404 kutadi). */
  readonly takesForeignId: boolean;
}

const MATRIX: Spec[] = [
  { method: 'GET', pattern: '/api/dashboard', path: () => '/api/dashboard', takesForeignId: false },
  { method: 'GET', pattern: '/api/customers', path: () => '/api/customers', takesForeignId: false },
  {
    method: 'POST',
    pattern: '/api/customers',
    path: () => '/api/customers',
    body: { name: 'Hack' },
    key: true,
    takesForeignId: false,
  },
  {
    method: 'GET',
    pattern: '/api/customers/:id',
    path: (i) => `/api/customers/${i.customerId}`,
    takesForeignId: true,
  },
  {
    method: 'PATCH',
    pattern: '/api/customers/:id',
    path: (i) => `/api/customers/${i.customerId}`,
    body: { name: 'Hack' },
    takesForeignId: true,
  },
  {
    method: 'POST',
    pattern: '/api/customers/:id/archive',
    path: (i) => `/api/customers/${i.customerId}/archive`,
    takesForeignId: true,
  },
  {
    method: 'POST',
    pattern: '/api/customers/:id/unarchive',
    path: (i) => `/api/customers/${i.customerId}/unarchive`,
    takesForeignId: true,
  },
  {
    method: 'GET',
    pattern: '/api/customers/:id/ledger',
    path: (i) => `/api/customers/${i.customerId}/ledger`,
    takesForeignId: true,
  },
  {
    method: 'GET',
    pattern: '/api/customers/:id/preview',
    path: (i) => `/api/customers/${i.customerId}/preview?type=payment&amount=1`,
    takesForeignId: true,
  },
  {
    method: 'POST',
    pattern: '/api/customers/:id/debts',
    path: (i) => `/api/customers/${i.customerId}/debts`,
    body: { amount: 1 },
    key: true,
    takesForeignId: true,
  },
  {
    method: 'POST',
    pattern: '/api/customers/:id/payments',
    path: (i) => `/api/customers/${i.customerId}/payments`,
    body: { amount: 1 },
    key: true,
    takesForeignId: true,
  },
  {
    method: 'POST',
    pattern: '/api/customers/:id/adjustments',
    path: (i) => `/api/customers/${i.customerId}/adjustments`,
    body: { amount: 1, description: 'x' },
    key: true,
    takesForeignId: true,
  },
  {
    method: 'POST',
    pattern: '/api/entries/:id/delete',
    path: (i) => `/api/entries/${i.entryId}/delete`,
    body: {},
    key: true,
    takesForeignId: true,
  },
  { method: 'GET', pattern: '/api/staff', path: () => '/api/staff', takesForeignId: false },
  {
    method: 'POST',
    pattern: '/api/staff/invites',
    path: () => '/api/staff/invites',
    key: true,
    takesForeignId: false,
  },
  {
    method: 'POST',
    pattern: '/api/staff/:userId/revoke',
    path: (i) => `/api/staff/${i.staffUserId}/revoke`,
    takesForeignId: true,
  },
  { method: 'GET', pattern: '/api/business', path: () => '/api/business', takesForeignId: false },
  {
    method: 'PATCH',
    pattern: '/api/business',
    path: () => '/api/business',
    body: { name: 'Hack' },
    takesForeignId: false,
  },
  { method: 'GET', pattern: '/api/billing', path: () => '/api/billing', takesForeignId: false },
];

/** Biznes ma'lumotiga tegmaydigan yoki alohida tekshiriladigan yo'llar. */
const NON_TENANT = new Set([
  'GET /healthz',
  'GET /readyz',
  'POST /telegram/webhook',
  'POST /api/auth/telegram',
  'GET /api/me',
  'PATCH /api/me',
  'POST /api/businesses/active',
]);

let h: ApiHarness;
let a: Shop;
let b: Shop;
let ids: Ids;
let before: Awaited<ReturnType<typeof snapshot>>;

async function snapshot() {
  const q = async (sql: string) => (await h.sys.query(sql, [a.businessId])).rows;
  return {
    customers: await q(
      'SELECT id, name, status, normalized_name FROM customers WHERE business_id = $1 ORDER BY id',
    ),
    entries: await q(
      'SELECT id, type, amount, customer_id FROM ledger_entries WHERE business_id = $1 ORDER BY seq',
    ),
    balances: await q(
      'SELECT customer_id, balance FROM customer_balances WHERE business_id = $1 ORDER BY customer_id',
    ),
    members: await q(
      'SELECT user_id, role, status FROM business_members WHERE business_id = $1 ORDER BY user_id',
    ),
    business: await q('SELECT name, notify_owner_on_delete FROM businesses WHERE id = $1'),
    invites: await q('SELECT count(*)::int AS n FROM invites WHERE business_id = $1'),
    audit: await q(
      "SELECT count(*)::int AS n FROM audit_logs WHERE business_id = $1 AND action NOT LIKE 'business.create'",
    ),
  };
}

beforeAll(async () => {
  h = await createApiHarness();
  a = await h.shop();
  b = await h.shop();
  const customerId = await a.customer('Maxfiy A mijozi', 777000);
  const entryId = (
    await h.sys.query('SELECT id FROM ledger_entries WHERE customer_id = $1', [customerId])
  ).rows[0].id as string;
  ids = { customerId, entryId, staffUserId: a.staff.id };
  before = await snapshot();
});
afterAll(async () => {
  await h.close();
});

const attackerCall = (spec: Spec, options: { businessId?: string; token?: string | null }) =>
  h.call(spec.method, spec.path(ids), {
    token: options.token === undefined ? b.owner.token : options.token,
    ...(options.businessId ? { businessId: options.businessId } : {}),
    ...(spec.body !== undefined ? { body: spec.body } : {}),
    ...(spec.key ? { key: true as const } : {}),
  });

const LEAK = ['Maxfiy A mijozi', '777000', 'Test do‘kon'.length ? '' : ''].filter(Boolean);
const noLeak = (body: unknown, ctx: string) => {
  const text = JSON.stringify(body ?? null);
  for (const needle of [ids.customerId, ids.entryId, a.businessId, ...LEAK])
    expect(text, `${ctx}: ${needle}`).not.toContain(needle);
};

describe('matritsa to‘liqligi', () => {
  it('ro‘yxatdan o‘tgan har bir yo‘l matritsada yoki NON_TENANT ro‘yxatida', () => {
    const registered = new Set(
      h.app.registeredRoutes
        .filter((r) => r.method !== 'HEAD' && r.method !== 'OPTIONS')
        .filter((r) => !r.url.startsWith('/api/_t/'))
        // Superadmin yo'llari alohida: admin.int.test.ts (oddiy foydalanuvchiga hammasi 404)
        .filter((r) => !r.url.startsWith('/api/admin/'))
        .map((r) => `${r.method} ${r.url}`),
    );
    const covered = new Set([...MATRIX.map((m) => `${m.method} ${m.pattern}`), ...NON_TENANT]);
    const missing = [...registered].filter((r) => !covered.has(r)).toSorted();
    const stale = [...covered].filter((r) => !registered.has(r)).toSorted();
    expect(
      missing,
      'matritsada yo‘q yo‘llar (yangi yo‘l qo‘shilganda tenant testini ham qo‘shing)',
    ).toEqual([]);
    expect(stale, 'matritsada bor, lekin mavjud bo‘lmagan yo‘llar').toEqual([]);
  });
});

describe('hujum 1: boshqa biznesni selektor orqali tanlash (X-Business-Id = A)', () => {
  for (const spec of MATRIX) {
    it(`${spec.method} ${spec.pattern} → 403, ma’lumot sizmaydi`, async () => {
      const res = await attackerCall(spec, { businessId: a.businessId });
      expect(res.status).toBe(403);
      noLeak(res.body, spec.pattern);
    });
  }
  it('hujumlardan keyin A ma’lumoti o‘zgarmagan', async () => {
    expect(await snapshot()).toEqual(before);
  });
});

describe('hujum 2: o‘z biznesi, lekin A ning resurs ID lari', () => {
  for (const spec of MATRIX.filter((s) => s.takesForeignId)) {
    it(`${spec.method} ${spec.pattern} → 404`, async () => {
      const res = await attackerCall(spec, { businessId: b.businessId });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      noLeak(res.body, spec.pattern);
    });
  }
  it('B ning ro‘yxat/dashboard/xodimlar/sozlamalari faqat B ma’lumotini qaytaradi', async () => {
    for (const spec of MATRIX.filter((s) => !s.takesForeignId && s.method === 'GET')) {
      const res = await attackerCall(spec, { businessId: b.businessId });
      expect(res.status, spec.pattern).toBe(200);
      noLeak(res.body, spec.pattern);
    }
  });
  it('B yaratgan narsalar A ga tushmaydi, A ma’lumoti o‘zgarmagan', async () => {
    // B o'z biznesida yozuvchi yo'llarni ishlatdi (POST /api/customers, PATCH /api/business, invites): A ga ta'sir yo'q
    for (const spec of MATRIX.filter((s) => !s.takesForeignId && s.method !== 'GET')) {
      await attackerCall(spec, { businessId: b.businessId });
    }
    expect(await snapshot()).toEqual(before);
  });
});

describe('hujum 3: a’zoligi yo‘q foydalanuvchi va tokensiz so‘rov', () => {
  it('biznesi yo‘q foydalanuvchi hamma yo‘lda 409 BUSINESS_REQUIRED (selektorsiz) yoki 403 (selektor bilan)', async () => {
    const outsider = await (async () => {
      const { createUser } = await import('../../test/fixtures.js');
      return h.tokenFor(await createUser(h.pool, 'outsider'));
    })();
    for (const spec of MATRIX) {
      const plain = await attackerCall(spec, { token: outsider });
      expect(plain.status, `${spec.pattern} selektorsiz`).toBe(409);
      const withSelector = await attackerCall(spec, { token: outsider, businessId: a.businessId });
      expect(withSelector.status, `${spec.pattern} selektor bilan`).toBe(403);
      noLeak(withSelector.body, spec.pattern);
    }
  });

  it('tokensiz hamma yo‘lda 401', async () => {
    for (const spec of MATRIX) {
      expect((await attackerCall(spec, { token: null })).status, spec.pattern).toBe(401);
    }
  });

  it('noto‘g‘ri/soxta/eskirgan token', async () => {
    const forged = `v1.${Buffer.from(JSON.stringify({ typ: 'miniapp-session', sub: a.owner.id, iat: 0, exp: 9999999999 })).toString('base64url')}.AAAA`;
    for (const token of ['garbage', forged, `${a.owner.token}x`]) {
      expect(
        (await h.call('GET', '/api/dashboard', { token, businessId: a.businessId })).status,
      ).toBe(401);
    }
  });

  it('klient yuborgan rol/user_id sarlavhalari e’tiborsiz: xodim egasi huquqini ola olmaydi', async () => {
    const res = await h.call('GET', '/api/staff', {
      token: a.staff.token,
      businessId: a.businessId,
      headers: { 'x-role': 'OWNER', 'x-user-id': a.owner.id },
    });
    expect(res.status).toBe(403);
  });

  it('revoke qilingan A xodimi A ma’lumotini ko‘ra olmaydi (eski token bilan ham)', async () => {
    const shop = await h.shop();
    await shop.customer('Revoke sinovi', 1000);
    expect(
      (
        await h.call('GET', '/api/customers', {
          token: shop.staff.token,
          businessId: shop.businessId,
        })
      ).status,
    ).toBe(200);
    await h.call('POST', `/api/staff/${shop.staff.id}/revoke`, {
      token: shop.owner.token,
      businessId: shop.businessId,
    });
    for (const url of ['/api/customers', '/api/dashboard', '/api/business']) {
      const res = await h.call('GET', url, {
        token: shop.staff.token,
        businessId: shop.businessId,
      });
      expect(res.status, url).toBe(403);
    }
  });
});

describe('qoldiq/yozuv A da buzilmagani', () => {
  it('A egasi o‘z ma’lumotini ko‘radi (nazorat testi)', async () => {
    const res = await h.call('GET', `/api/customers/${ids.customerId}`, {
      token: a.owner.token,
      businessId: a.businessId,
    });
    expect(res.status).toBe(200);
    expect(res.body.balance).toBe(777000);
    expect(randomUUID()).toBeTruthy();
  });
});
