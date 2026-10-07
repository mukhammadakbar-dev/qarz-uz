import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiHarness, type ApiHarness, type Shop } from '../../test/api-harness.js';

let h: ApiHarness;
beforeAll(async () => {
  h = await createApiHarness();
});
afterAll(async () => {
  await h.close();
});

const as = (s: Shop, who: 'owner' | 'staff' = 'owner') => ({
  token: s[who].token,
  businessId: s.businessId,
});

describe('autentifikatsiya va umumiy format', () => {
  it('tokensiz hamma himoyalangan yo‘l 401', async () => {
    const res = await h.call('GET', '/api/dashboard');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('domen xatolari code/message/details bilan qaytadi', async () => {
    const s = await h.shop();
    const id = await s.customer('Murod', 100000);
    const res = await h.call('POST', `/api/customers/${id}/payments`, {
      ...as(s),
      key: true,
      body: { amount: 150000 },
    });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'OVERPAYMENT', details: { maxPayable: 100000 } });
  });

  it('noto‘g‘ri tana — 400, qaysi maydon ekani aytiladi', async () => {
    const s = await h.shop();
    const res = await h.call('POST', '/api/customers', { ...as(s), key: true, body: { name: '' } });
    expect(res.status).toBe(400);
    expect(res.body.details.fields).toEqual(['name']);
  });

  it('xavfsizlik sarlavhalari: CSP bor, X-Frame-Options yo‘q (Telegram Web iframe)', async () => {
    const res = await h.call('GET', '/healthz');
    expect(String(res.headers['content-security-policy'])).toContain(
      "frame-ancestors 'self' https://web.telegram.org",
    );
    expect(res.headers['x-frame-options']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('CORS: faqat sozlangan origin', async () => {
    const ok = await h.app.inject({
      method: 'OPTIONS',
      url: '/api/customers',
      headers: { origin: 'https://nasiya.example.uz', 'access-control-request-method': 'POST' },
    });
    expect(ok.headers['access-control-allow-origin']).toBe('https://nasiya.example.uz');
    const bad = await h.app.inject({
      method: 'OPTIONS',
      url: '/api/customers',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('dashboard, mijozlar, tarix (TT §31–33)', () => {
  it('dashboard: biznes, rol, jami qarz, qarzdorlar, bugungi operatsiyalar, obuna', async () => {
    const s = await h.shop();
    await s.customer('Murod', 450000);
    await s.customer('Ali', 250000);
    await s.customer('Vali', 0);
    const res = await h.call('GET', '/api/dashboard', as(s));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      business: { id: s.businessId, name: 'Test do‘kon' },
      role: 'OWNER',
      summary: { totalDebt: 700000, debtorsCount: 2, todayOperations: 2 },
      subscription: { state: 'TRIAL' },
    });
    expect((await h.call('GET', '/api/dashboard', as(s, 'staff'))).body.role).toBe('STAFF');
  });

  it('mijozlar ro‘yxati: qidiruv, saralash, sahifalash', async () => {
    const s = await h.shop();
    for (const [n, d] of [
      ['Murod', 300],
      ['Murodbek', 100],
      ['Ali', 200],
    ] as const)
      await s.customer(n, d);
    const byDebt = await h.call('GET', '/api/customers?sort=debt', as(s));
    expect(byDebt.body.items.map((c: any) => c.name)).toEqual(['Murod', 'Ali', 'Murodbek']);
    const search = await h.call('GET', '/api/customers?q=murod&sort=name', as(s));
    expect(search.body.items.map((c: any) => c.name)).toEqual(['Murod', 'Murodbek']);
    const p1 = await h.call('GET', '/api/customers?sort=name&limit=2', as(s));
    expect(p1.body.items).toHaveLength(2);
    const p2 = await h.call(
      'GET',
      `/api/customers?sort=name&limit=2&cursor=${encodeURIComponent(p1.body.nextCursor)}`,
      as(s),
    );
    expect(p2.body.items).toHaveLength(1);
    expect(p2.body.nextCursor).toBeNull();
    expect((await h.call('GET', '/api/customers?debtors=true', as(s))).body.items).toHaveLength(3);
    expect((await h.call('GET', '/api/customers?sort=nope', as(s))).status).toBe(400);
  });

  it('mijoz yaratish → olish → tahrirlash → arxivlash', async () => {
    const s = await h.shop();
    const created = await h.call('POST', '/api/customers', {
      ...as(s, 'staff'),
      key: true,
      body: { name: 'Akmal', phone: '90 123 45 67', notes: 'yaqin' },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: 'Akmal',
      phone: '+998901234567',
      balance: 0,
      status: 'ACTIVE',
    });
    const id = created.body.id;
    expect((await h.call('GET', `/api/customers/${id}`, as(s))).body.notes).toBe('yaqin');
    const patched = await h.call('PATCH', `/api/customers/${id}`, {
      ...as(s),
      body: { name: 'Akmaljon', notes: null },
    });
    expect(patched.body).toMatchObject({ name: 'Akmaljon', notes: null });
    // staff arxivlay olmaydi, owner oladi
    expect((await h.call('POST', `/api/customers/${id}/archive`, as(s, 'staff'))).status).toBe(403);
    expect((await h.call('POST', `/api/customers/${id}/archive`, as(s))).body.status).toBe(
      'ARCHIVED',
    );
    expect((await h.call('POST', `/api/customers/${id}/unarchive`, as(s))).body.status).toBe(
      'ACTIVE',
    );
  });

  it('bir xil ismli mijoz: 409 LABEL_REQUIRED', async () => {
    const s = await h.shop();
    await s.customer('Ali');
    const res = await h.call('POST', '/api/customers', {
      ...as(s),
      key: true,
      body: { name: 'Ali' },
    });
    expect(res.status).toBe(409);
    expect(res.body.details.reason).toBe('LABEL_REQUIRED');
  });

  it('nasiya, to‘lov, tarix (qoldiq bilan) va preview', async () => {
    const s = await h.shop();
    const id = await s.customer('Murod');
    const debt = await h.call('POST', `/api/customers/${id}/debts`, {
      ...as(s),
      key: true,
      body: { amount: 450000, description: 'un' },
    });
    expect(debt.status).toBe(201);
    expect(debt.body).toMatchObject({
      balance: 450000,
      replayed: false,
      entry: { type: 'DEBT', amount: 450000, source: 'MINIAPP', description: 'un' },
    });
    const pay = await h.call('POST', `/api/customers/${id}/payments`, {
      ...as(s, 'staff'),
      key: true,
      body: { amount: 200000 },
    });
    expect(pay.body.balance).toBe(250000);

    const prev = await h.call(
      'GET',
      `/api/customers/${id}/preview?type=payment&amount=300000`,
      as(s),
    );
    expect(prev.body).toMatchObject({ allowed: false, maxPayable: 250000, balance: 250000 });
    expect(
      (await h.call('GET', `/api/customers/${id}/preview?type=payment&amount=50000`, as(s))).body,
    ).toMatchObject({ allowed: true, balanceAfter: 200000 });
    expect(
      (await h.call('GET', `/api/customers/${id}/preview?type=debt&amount=1000`, as(s))).body,
    ).toMatchObject({ balanceAfter: 251000 });

    const hist = await h.call('GET', `/api/customers/${id}/ledger`, as(s));
    expect(hist.body.items.map((i: any) => [i.type, i.delta, i.runningBalance])).toEqual([
      ['PAYMENT', -200000, 250000],
      ['DEBT', 450000, 450000],
    ]);
  });

  it('“kecha yozgan edim”: dateOffsetDays', async () => {
    const s = await h.shop();
    const id = await s.customer('Murod');
    const res = await h.call('POST', `/api/customers/${id}/debts`, {
      ...as(s),
      key: true,
      body: { amount: 1000, dateOffsetDays: -1 },
    });
    expect(res.status).toBe(201);
    expect(
      (
        await h.call('POST', `/api/customers/${id}/debts`, {
          ...as(s),
          key: true,
          body: { amount: 1000, dateOffsetDays: 1 },
        })
      ).status,
    ).toBe(400);
  });

  it('o‘chirish (storno): xodim ham o‘chira oladi, egasiga xabar ketadi', async () => {
    const s = await h.shop();
    const id = await s.customer('Murod', 5000);
    const entries = (await h.call('GET', `/api/customers/${id}/ledger`, as(s))).body.items;
    h.sentMessages.length = 0;
    const del = await h.call('POST', `/api/entries/${entries[0].id}/delete`, {
      ...as(s, 'staff'),
      key: true,
      body: { reason: 'xato' },
    });
    expect(del.status).toBe(200);
    expect(del.body).toMatchObject({
      balance: 0,
      original: { id: entries[0].id },
      entry: { type: 'ADJUSTMENT', reversesEntryId: entries[0].id },
    });
    expect(h.sentMessages).toHaveLength(1);
    expect(h.sentMessages[0]!.chatId).toBe(s.owner.telegramId);
    expect(h.sentMessages[0]!.text).toContain('o‘chirdi');
    // ikkinchi marta (yangi kalit): allaqachon o'chirilgan
    const again = await h.call('POST', `/api/entries/${entries[0].id}/delete`, {
      ...as(s),
      key: true,
      body: {},
    });
    expect(again.status).toBe(409);
    expect(again.body.details.reason).toBe('ALREADY_REVERSED');
  });

  it('keyingi to‘lovi bor nasiyani o‘chirib bo‘lmaydi (409)', async () => {
    const s = await h.shop();
    const id = await s.customer('Murod', 100000);
    await h.call('POST', `/api/customers/${id}/payments`, {
      ...as(s),
      key: true,
      body: { amount: 60000 },
    });
    const debtEntry = (await h.call('GET', `/api/customers/${id}/ledger`, as(s))).body.items.find(
      (i: any) => i.type === 'DEBT',
    );
    const res = await h.call('POST', `/api/entries/${debtEntry.id}/delete`, {
      ...as(s),
      key: true,
      body: {},
    });
    expect(res.status).toBe(409);
    expect(res.body.details.reason).toBe('REVERSAL_WOULD_OVERDRAW');
  });

  it('tuzatish (adjustment): faqat egasi, sabab majburiy', async () => {
    const s = await h.shop();
    const id = await s.customer('Murod', 100000);
    const url = `/api/customers/${id}/adjustments`;
    expect(
      (
        await h.call('POST', url, {
          ...as(s, 'staff'),
          key: true,
          body: { amount: -1000, description: 'x' },
        })
      ).status,
    ).toBe(403);
    expect(
      (await h.call('POST', url, { ...as(s), key: true, body: { amount: -1000 } })).status,
    ).toBe(400);
    const ok = await h.call('POST', url, {
      ...as(s),
      key: true,
      body: { amount: -1000, description: 'inventarizatsiya' },
    });
    expect(ok.status).toBe(201);
    expect(ok.body.balance).toBe(99000);
  });
});

describe('idempotentlik (ADR-0003 §3, AC-05)', () => {
  it('Idempotency-Key majburiy', async () => {
    const s = await h.shop();
    const id = await s.customer('Murod');
    const res = await h.call('POST', `/api/customers/${id}/debts`, {
      ...as(s),
      body: { amount: 1000 },
    });
    expect(res.status).toBe(400);
    expect(res.body.details.reason).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const short = await h.call('POST', `/api/customers/${id}/debts`, {
      ...as(s),
      key: 'x',
      body: { amount: 1000 },
    });
    expect(short.status).toBe(400);
  });

  it('bir xil kalit va tana: ikkinchi javob saqlangan nusxa, yozuv bitta', async () => {
    const s = await h.shop();
    const id = await s.customer('Murod');
    const key = randomUUID();
    const first = await h.call('POST', `/api/customers/${id}/debts`, {
      ...as(s),
      key,
      body: { amount: 450000 },
    });
    const second = await h.call('POST', `/api/customers/${id}/debts`, {
      ...as(s),
      key,
      body: { amount: 450000 },
    });
    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    const count = await h.sys.query(
      'SELECT count(*)::int AS n FROM ledger_entries WHERE customer_id = $1',
      [id],
    );
    expect(count.rows[0].n).toBe(1);
  });

  it('bir xil kalit, boshqa tana → 422', async () => {
    const s = await h.shop();
    const id = await s.customer('Murod');
    const key = randomUUID();
    await h.call('POST', `/api/customers/${id}/debts`, { ...as(s), key, body: { amount: 1000 } });
    const res = await h.call('POST', `/api/customers/${id}/debts`, {
      ...as(s),
      key,
      body: { amount: 2000 },
    });
    expect(res.status).toBe(422);
    expect(res.body.details.reason).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('8 ta parallel bir xil so‘rov → bitta yozuv', async () => {
    const s = await h.shop();
    const id = await s.customer('Murod');
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        h.call('POST', `/api/customers/${id}/debts`, { ...as(s), key, body: { amount: 7000 } }),
      ),
    );
    const ok = results.filter((r) => r.status === 201 || r.status === 200);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    for (const r of results) expect([200, 201, 409]).toContain(r.status);
    const count = await h.sys.query(
      'SELECT count(*)::int AS n, sum(amount)::int AS total FROM ledger_entries WHERE customer_id = $1',
      [id],
    );
    expect(count.rows[0]).toEqual({ n: 1, total: 7000 });
  });

  it('xato bilan tugagan so‘rov saqlanmaydi: tuzatib shu kalit bilan qayta yuborish mumkin', async () => {
    const s = await h.shop();
    const id = await s.customer('Murod', 1000);
    const key = randomUUID();
    const bad = await h.call('POST', `/api/customers/${id}/payments`, {
      ...as(s),
      key,
      body: { amount: 5000 },
    });
    expect(bad.status).toBe(422);
    // Xuddi shu kalit va xuddi shu tana yana xato beradi (saqlanmagan); boshqa tana esa 422 emas, yangi so'rov sifatida o'tadi
    const fresh = await h.call('POST', `/api/customers/${id}/payments`, {
      ...as(s),
      key,
      body: { amount: 500 },
    });
    expect(fresh.status).toBe(201);
  });

  it('kalitlar foydalanuvchi bo‘yicha: boshqa foydalanuvchi shu kalitni ishlata oladi', async () => {
    const s = await h.shop();
    const id = await s.customer('Murod');
    const key = randomUUID();
    const a = await h.call('POST', `/api/customers/${id}/debts`, {
      ...as(s),
      key,
      body: { amount: 1000 },
    });
    const b = await h.call('POST', `/api/customers/${id}/debts`, {
      ...as(s, 'staff'),
      key,
      body: { amount: 1000 },
    });
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.entry.id).not.toBe(b.body.entry.id);
  });
});

describe('xodimlar, sozlamalar, obuna (TT §34)', () => {
  it('egasi taklif havolasi yaratadi; xodim yarata olmaydi', async () => {
    const s = await h.shop();
    const res = await h.call('POST', '/api/staff/invites', { ...as(s), key: true });
    expect(res.status).toBe(201);
    expect(res.body.link).toMatch(/^https:\/\/t\.me\/tdaftar_bot\?start=inv_[A-Za-z0-9_-]{32}$/);
    expect(
      (await h.call('POST', '/api/staff/invites', { ...as(s, 'staff'), key: true })).status,
    ).toBe(403);
    expect((await h.call('GET', '/api/staff', as(s, 'staff'))).status).toBe(403);
  });

  it('xodimlar ro‘yxati va o‘chirish: darhol kirish yopiladi, egasini o‘chirib bo‘lmaydi', async () => {
    const s = await h.shop();
    const list = await h.call('GET', '/api/staff', as(s));
    expect(list.body.members.map((m: any) => [m.role, m.status])).toEqual([
      ['OWNER', 'ACTIVE'],
      ['STAFF', 'ACTIVE'],
    ]);

    expect((await h.call('GET', '/api/dashboard', as(s, 'staff'))).status).toBe(200);
    const revoked = await h.call('POST', `/api/staff/${s.staff.id}/revoke`, as(s));
    expect(revoked.status).toBe(200);
    expect(revoked.body.status).toBe('REVOKED');
    // Eski token bilan ham darhol yopiq
    expect((await h.call('GET', '/api/dashboard', as(s, 'staff'))).status).toBe(403);
    expect((await h.call('GET', '/api/dashboard', { token: s.staff.token })).status).toBe(409);
    // Takroriy chaqiruv idempotent
    expect((await h.call('POST', `/api/staff/${s.staff.id}/revoke`, as(s))).status).toBe(200);
    // Egasini o'chirib bo'lmaydi
    const own = await h.call('POST', `/api/staff/${s.owner.id}/revoke`, as(s));
    expect(own.status).toBe(409);
    expect(own.body.details.reason).toBe('CANNOT_REVOKE_OWNER');
    expect((await h.call('POST', `/api/staff/${randomUUID()}/revoke`, as(s))).status).toBe(404);
  });

  it('biznes sozlamalari: nom va egasiga xabar; xodim o‘zgartira olmaydi', async () => {
    const s = await h.shop();
    expect(
      (await h.call('PATCH', '/api/business', { ...as(s, 'staff'), body: { name: 'Hack' } }))
        .status,
    ).toBe(403);
    const res = await h.call('PATCH', '/api/business', {
      ...as(s),
      body: { name: '  Yangi   nom ', notifyOwnerOnDelete: false },
    });
    expect(res.body).toMatchObject({
      name: 'Yangi nom',
      notifyOwnerOnDelete: false,
      currency: 'UZS',
    });
    expect(
      (await h.call('PATCH', '/api/business', { ...as(s), body: { name: '/start' } })).status,
    ).toBe(400);
    expect(
      (await h.call('PATCH', '/api/business', { ...as(s), body: { unknown: 1 } })).status,
    ).toBe(400);
    expect((await h.call('GET', '/api/business', as(s, 'staff'))).body.name).toBe('Yangi nom');
  });

  it('obuna: faqat egasi ko‘radi (narx, kod, kontakt)', async () => {
    const s = await h.shop();
    const res = await h.call('GET', '/api/billing', as(s));
    expect(res.body).toMatchObject({
      status: { state: 'TRIAL' },
      priceUzs: 29000,
      supportPhone: '+998907900110',
    });
    expect(res.body.shortCode).toMatch(/^TD-/);
    expect((await h.call('GET', '/api/billing', as(s, 'staff'))).status).toBe(403);
  });

  it('obuna tugagan: yozish 402, o‘qish ishlaydi', async () => {
    const s = await h.shop();
    const id = await s.customer('Murod', 1000);
    await h.sys.query(
      "UPDATE subscriptions SET trial_ends_at = now() - interval '1 hour' WHERE business_id = $1",
      [s.businessId],
    );
    const write = await h.call('POST', `/api/customers/${id}/debts`, {
      ...as(s),
      key: true,
      body: { amount: 5 },
    });
    expect(write.status).toBe(402);
    expect(write.body.code).toBe('SUBSCRIPTION_EXPIRED');
    expect(
      (await h.call('POST', '/api/customers', { ...as(s), key: true, body: { name: 'Yangi' } }))
        .status,
    ).toBe(402);
    expect((await h.call('GET', `/api/customers/${id}`, as(s))).body.balance).toBe(1000);
    expect((await h.call('GET', '/api/dashboard', as(s))).body.subscription.state).toBe('EXPIRED');
  });
});

describe('biznes tanlash', () => {
  it('faqat a’zo bo‘lgan biznesga o‘tish mumkin', async () => {
    const a = await h.shop();
    const b = await h.shop();
    const bad = await h.call('POST', '/api/businesses/active', {
      token: a.owner.token,
      body: { businessId: b.businessId },
    });
    expect(bad.status).toBe(403);
    const ok = await h.call('POST', '/api/businesses/active', {
      token: a.owner.token,
      body: { businessId: a.businessId },
    });
    expect(ok.body).toEqual({ activeBusinessId: a.businessId, role: 'OWNER' });
    expect(
      (
        await h.call('POST', '/api/businesses/active', {
          token: a.owner.token,
          body: { businessId: 'x' },
        })
      ).status,
    ).toBe(400);
  });
});

describe('tezlik cheklovi', () => {
  it('chegaradan oshganda 429; healthz o‘chirilmagan', async () => {
    const limited = await createApiHarness({ API_RATE_LIMIT_PER_MINUTE: '10' });
    try {
      const s = await limited.shop();
      const statuses: number[] = [];
      for (let i = 0; i < 14; i++)
        statuses.push(
          (
            await limited.call('GET', '/api/dashboard', {
              token: s.owner.token,
              businessId: s.businessId,
            })
          ).status,
        );
      expect(statuses.slice(0, 10).every((x) => x === 200)).toBe(true);
      expect(statuses.slice(10)).toContain(429);
      const blocked = await limited.call('GET', '/api/dashboard', {
        token: s.owner.token,
        businessId: s.businessId,
      });
      expect(blocked.body.code).toBe('RATE_LIMITED');
      // Boshqa foydalanuvchi (token) ta'sirlanmaydi
      expect(
        (
          await limited.call('GET', '/api/dashboard', {
            token: s.staff.token,
            businessId: s.businessId,
          })
        ).status,
      ).toBe(200);
      for (let i = 0; i < 30; i++) expect((await limited.call('GET', '/healthz')).status).toBe(200);
    } finally {
      await limited.close();
    }
  });
});
