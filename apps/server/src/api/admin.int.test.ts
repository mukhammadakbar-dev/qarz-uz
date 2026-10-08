import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiHarness, type ApiHarness, type Shop } from '../../test/api-harness.js';

/**
 * Superadmin API (ADR-0008): kirish faqat SUPERADMIN_TELEGRAM_IDS ga; do'kon ichi faqat o'qiladi va audit'ga
 * yoziladi; obuna uzaytirish idempotent; bloklangan do'kon yoza olmaydi; broadcast har kimga bir marta.
 */

const ADMIN_TG = 7_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
let h: ApiHarness;
let admin: { id: string; token: string };
let shop: Shop;
let customerId: string;

beforeAll(async () => {
  h = await createApiHarness({ SUPERADMIN_TELEGRAM_IDS: String(ADMIN_TG) });
  const { rows } = await h.sys.query<{ id: string }>(
    "INSERT INTO users (telegram_user_id, first_name) VALUES ($1, 'Admin') RETURNING id",
    [ADMIN_TG],
  );
  admin = { id: rows[0]!.id, token: h.tokenFor(rows[0]!.id) };
  shop = await h.shop();
  customerId = await shop.customer('Maxfiy Murod', 450000);
});
afterAll(async () => {
  await h.close();
});

const asAdmin = (method: string, url: string, body?: unknown, key?: string | true) =>
  h.call(method, url, {
    token: admin.token,
    ...(body !== undefined ? { body } : {}),
    ...(key ? { key } : {}),
  });
const shortCode = async (businessId: string) =>
  (await h.sys.query('SELECT short_code FROM businesses WHERE id = $1', [businessId])).rows[0]
    .short_code as string;
const auditCount = async (businessId: string, action: string) =>
  (
    await h.sys.query(
      'SELECT count(*)::int AS n FROM audit_logs WHERE business_id = $1 AND action = $2 AND actor_user_id = $3',
      [businessId, action, admin.id],
    )
  ).rows[0].n as number;

describe('kirish', () => {
  it('oddiy foydalanuvchiga barcha /api/admin yo‘llari 404 (panel borligi bilinmaydi); tokensiz 401', async () => {
    const routes = h.app.registeredRoutes.filter(
      (r) => r.url.startsWith('/api/admin/') && r.method !== 'HEAD' && r.method !== 'OPTIONS',
    );
    expect(routes.length).toBeGreaterThanOrEqual(11);
    for (const r of routes) {
      const url = r.url.replace(':customerId', customerId).replace(':id', shop.businessId);
      const asOwner = await h.call(r.method, url, { token: shop.owner.token, body: {}, key: true });
      expect(asOwner.status, `${r.method} ${r.url}`).toBe(404);
      const anon = await h.call(r.method, url, { body: {} });
      expect(anon.status, `${r.method} ${r.url}`).toBe(401);
    }
  });

  it('/api/me superadminni belgilaydi', async () => {
    expect((await asAdmin('GET', '/api/me')).body.isSuperadmin).toBe(true);
    expect((await h.call('GET', '/api/me', { token: shop.owner.token })).body.isSuperadmin).toBe(
      false,
    );
  });
});

describe('do‘konlar', () => {
  it('statistika', async () => {
    const res = await asAdmin('GET', '/api/admin/stats');
    expect(res.status).toBe(200);
    expect(res.body.businesses).toBeGreaterThanOrEqual(1);
    expect(res.body.customers).toBeGreaterThanOrEqual(1);
    expect(res.body.totalDebt).toBeGreaterThanOrEqual(450000);
  });

  it('ro‘yxat: kod bo‘yicha qidiruv, ega, mijozlar soni, jami qarz, obuna', async () => {
    const code = await shortCode(shop.businessId);
    const res = await asAdmin('GET', `/api/admin/businesses?q=${code}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    const b = res.body.items[0];
    expect(b).toMatchObject({
      id: shop.businessId,
      shortCode: code,
      customers: 1,
      totalDebt: 450000,
      staff: 1,
      suspendedAt: null,
      owner: { telegramUserId: shop.owner.telegramId },
      subscription: { state: 'TRIAL' },
    });
  });

  it('tafsilot: a’zolar, ko‘rish audit’ga yoziladi', async () => {
    const before = await auditCount(shop.businessId, 'admin.business.view');
    const res = await asAdmin('GET', `/api/admin/businesses/${shop.businessId}`);
    expect(res.status).toBe(200);
    expect(res.body.members.map((m: { role: string }) => m.role)).toEqual(['OWNER', 'STAFF']);
    expect(res.body.entries).toBe(1);
    expect(await auditCount(shop.businessId, 'admin.business.view')).toBe(before + 1);
    expect((await asAdmin('GET', `/api/admin/businesses/${randomUUID()}`)).status).toBe(404);
  });

  it('mijozlar va tarix faqat o‘qiladi, audit bilan', async () => {
    const list = await asAdmin('GET', `/api/admin/businesses/${shop.businessId}/customers`);
    expect(list.body.items.map((c: { name: string }) => c.name)).toEqual(['Maxfiy Murod']);
    const ledger = await asAdmin(
      'GET',
      `/api/admin/businesses/${shop.businessId}/customers/${customerId}/ledger`,
    );
    expect(ledger.body.items).toHaveLength(1);
    expect(await auditCount(shop.businessId, 'admin.customers.view')).toBeGreaterThanOrEqual(1);
    expect(await auditCount(shop.businessId, 'admin.ledger.view')).toBeGreaterThanOrEqual(1);
  });

  it('boshqa do‘kon mijozini bu do‘kon orqali ko‘rib bo‘lmaydi (RLS)', async () => {
    const other = await h.shop();
    const res = await asAdmin(
      'GET',
      `/api/admin/businesses/${other.businessId}/customers/${customerId}/ledger`,
    );
    expect(res.status).toBe(404);
  });

  it('superadmin do‘kon nomidan yoza olmaydi (a’zo emas)', async () => {
    const res = await h.call('POST', `/api/customers/${customerId}/debts`, {
      token: admin.token,
      businessId: shop.businessId,
      body: { amount: 1000 },
      key: true,
    });
    expect([403, 409]).toContain(res.status);
    expect(
      (
        await h.sys.query('SELECT count(*)::int AS n FROM ledger_entries WHERE business_id = $1', [
          shop.businessId,
        ])
      ).rows[0].n,
    ).toBe(1);
  });
});

describe('obuna uzaytirish', () => {
  it('Idempotency-Key bilan: qayta yuborilsa ikki marta uzaytirilmaydi; egasiga xabar boradi', async () => {
    const s = await h.shop();
    const { rows } = await h.sys.query(
      'SELECT trial_ends_at FROM subscriptions WHERE business_id = $1',
      [s.businessId],
    );
    const trialEnd = rows[0].trial_ends_at as Date;
    const key = randomUUID();
    const first = await asAdmin(
      'POST',
      `/api/admin/businesses/${s.businessId}/extend`,
      { months: 2 },
      key,
    );
    const replay = await asAdmin(
      'POST',
      `/api/admin/businesses/${s.businessId}/extend`,
      { months: 2 },
      key,
    );
    expect(first.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    // Sinov hali tugamagan: hisob sinov oxiridan boshlanadi
    expect(new Date(first.body.periodFrom).getTime()).toBe(trialEnd.getTime());
    const payments = await h.sys.query(
      'SELECT amount::int, months FROM subscription_payments WHERE business_id = $1',
      [s.businessId],
    );
    expect(payments.rows).toEqual([{ amount: 58000, months: 2 }]);
    expect(
      h.sentMessages.some((m) => m.chatId === s.owner.telegramId && m.text.includes('uzaytirildi')),
    ).toBe(true);
    const dash = await h.call('GET', '/api/dashboard', { token: s.owner.token });
    expect(dash.body.subscription.state).toBe('ACTIVE');
  });

  it('kalitsiz va noto‘g‘ri oy soni rad etiladi', async () => {
    const url = `/api/admin/businesses/${shop.businessId}/extend`;
    expect((await asAdmin('POST', url, { months: 1 })).status).toBe(400);
    expect((await asAdmin('POST', url, { months: 0 }, true)).status).toBe(400);
  });
});

describe('bloklash', () => {
  it('bloklangan do‘kon faqat o‘qiladi; egasi o‘zini blokdan chiqara olmaydi; blokdan chiqarilgach yozadi', async () => {
    const s = await h.shop();
    const c = await s.customer('Ali', 1000);
    const res = await asAdmin('POST', `/api/admin/businesses/${s.businessId}/suspend`, {
      reason: 'to‘lov muammosi',
    });
    expect(res.status).toBe(200);
    expect(
      h.sentMessages.some(
        (m) => m.chatId === s.owner.telegramId && m.text.includes('to‘lov muammosi'),
      ),
    ).toBe(true);

    const write = await h.call('POST', `/api/customers/${c}/debts`, {
      token: s.owner.token,
      body: { amount: 500 },
      key: true,
    });
    expect(write.status).toBe(402);
    expect(write.body.details.reason).toBe('SUSPENDED');
    expect((await h.call('GET', `/api/customers/${c}`, { token: s.owner.token })).status).toBe(200);
    expect(
      (await h.call('GET', '/api/dashboard', { token: s.owner.token })).body.business.suspended,
    ).toBe(true);

    // Ilova roli suspended_at ni o'zgartira olmaydi (ustun darajasidagi GRANT)
    await expect(
      h.pool.query('UPDATE businesses SET suspended_at = NULL WHERE id = $1', [s.businessId]),
    ).rejects.toMatchObject({ code: '42501' });

    expect(
      (
        await asAdmin(
          'GET',
          `/api/admin/businesses?filter=SUSPENDED&q=${await shortCode(s.businessId)}`,
        )
      ).body.items,
    ).toHaveLength(1);

    await asAdmin('POST', `/api/admin/businesses/${s.businessId}/unsuspend`, {});
    const again = await h.call('POST', `/api/customers/${c}/debts`, {
      token: s.owner.token,
      body: { amount: 500 },
      key: true,
    });
    expect(again.status).toBe(201);
    expect(await auditCount(s.businessId, 'business.suspend')).toBe(1);
    expect(await auditCount(s.businessId, 'business.unsuspend')).toBe(1);
  });
});

describe('broadcast', () => {
  const recipientsOf = async (broadcastId: string) =>
    (
      await h.sys.query<{ telegram_user_id: string; status: string }>(
        'SELECT telegram_user_id::text, status FROM broadcast_recipients WHERE broadcast_id = $1',
        [broadcastId],
      )
    ).rows.map((r) => ({ tg: Number(r.telegram_user_id), status: r.status }));

  it('faol obunachilar egalari; bot bloklangan — BLOCKED; xodimlar kiritilmaydi; qayta yuborish yo‘q', async () => {
    const a = await h.shop();
    const b = await h.shop();
    for (const s of [a, b])
      await asAdmin('POST', `/api/admin/businesses/${s.businessId}/extend`, { months: 1 }, true);
    h.blockedChats.add(b.owner.telegramId);

    const preview = await asAdmin('POST', '/api/admin/broadcasts/preview', {
      segments: ['ACTIVE'],
      includeStaff: false,
    });
    expect(preview.body.recipients).toBeGreaterThanOrEqual(2);

    const key = randomUUID();
    const body = { text: 'Yangi funksiya: hisobotlar!', segments: ['ACTIVE'], includeStaff: false };
    const created = await asAdmin('POST', '/api/admin/broadcasts', body, key);
    expect(created.status).toBe(201);
    expect(created.body.total).toBe(preview.body.recipients);
    const replay = await asAdmin('POST', '/api/admin/broadcasts', body, key);
    expect(replay.body.id).toBe(created.body.id);
    await h.broadcasts.kick();

    const rec = await recipientsOf(created.body.id);
    expect(rec).toContainEqual({ tg: a.owner.telegramId, status: 'SENT' });
    expect(rec).toContainEqual({ tg: b.owner.telegramId, status: 'BLOCKED' });
    expect(rec.map((r) => r.tg)).not.toContain(a.staff.telegramId);
    expect(rec.filter((r) => r.status === 'PENDING')).toEqual([]);
    expect(
      h.sentMessages.filter((m) => m.chatId === a.owner.telegramId && m.text === body.text),
    ).toHaveLength(1);

    const list = await asAdmin('GET', '/api/admin/broadcasts');
    const item = list.body.items.find((i: { id: string }) => i.id === created.body.id);
    expect(item).toMatchObject({ status: 'DONE', blocked: 1 });
    expect(item.sent + item.failed + item.blocked).toBe(item.total);

    // Yuboruvchi qayta ishga tushsa ham hech kimga ikkinchi marta bormaydi
    await h.broadcasts.kick();
    expect(
      h.sentMessages.filter((m) => m.chatId === a.owner.telegramId && m.text === body.text),
    ).toHaveLength(1);
  });

  it('xodimlar ham tanlansa ular ham oladi; bir odam bir marta', async () => {
    const s = await h.shop();
    await asAdmin('POST', `/api/admin/businesses/${s.businessId}/extend`, { months: 1 }, true);
    const created = await asAdmin(
      'POST',
      '/api/admin/broadcasts',
      { text: 'Xodimlar uchun', segments: ['ACTIVE'], includeStaff: true },
      true,
    );
    await h.broadcasts.kick();
    const tgs = (await recipientsOf(created.body.id)).map((r) => r.tg);
    expect(tgs).toContain(s.staff.telegramId);
    expect(new Set(tgs).size).toBe(tgs.length);
  });

  it('bo‘sh matn va segmentsiz so‘rov rad etiladi', async () => {
    expect(
      (
        await asAdmin(
          'POST',
          '/api/admin/broadcasts',
          { text: ' ', segments: ['ACTIVE'], includeStaff: false },
          true,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await asAdmin('POST', '/api/admin/broadcasts/preview', {
          segments: [],
          includeStaff: false,
        })
      ).status,
    ).toBe(400);
  });
});
