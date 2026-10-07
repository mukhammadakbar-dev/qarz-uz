import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_APP_URL, TEST_SYSTEM_URL } from '../../../test/env.js';
import * as fx from '../../../test/fixtures.js';
import { createPool } from '../../db/pool.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  SubscriptionExpiredError,
  ValidationError,
} from '../../errors/index.js';
import { resolveBusinessAccess, type BusinessAccess } from '../tenancy/index.js';
import {
  archiveCustomer,
  createCustomer,
  getCustomer,
  searchCustomers,
  unarchiveCustomer,
  updateCustomer,
  type Customer,
} from './index.js';

let pool: Pool;
let system: Pool;
beforeAll(() => {
  pool = createPool(TEST_APP_URL, { max: 8 });
  system = createPool(TEST_SYSTEM_URL, { max: 2 });
});
afterAll(async () => {
  await Promise.all([pool.end(), system.end()]);
});

async function setup() {
  const ownerId = await fx.createUser(pool, 'owner');
  const staffId = await fx.createUser(pool, 'staff');
  const businessId = await fx.createBusiness(pool, ownerId);
  await fx.addMember(pool, businessId, ownerId, staffId);
  const owner = await resolveBusinessAccess(pool, { id: ownerId, activeBusinessId: businessId });
  const staff = await resolveBusinessAccess(pool, { id: staffId, activeBusinessId: businessId });
  return { ownerId, staffId, businessId, owner, staff };
}

const reasonOf = async (p: Promise<unknown>) => {
  const e = await p.catch((x) => x);
  expect(e).toBeInstanceOf(ConflictError);
  return (e as ConflictError).details['reason'];
};

describe('createCustomer', () => {
  it('mijoz yaratadi: 0 balans, normallashtirilgan ism, telefon formati, audit', async () => {
    const { owner, businessId } = await setup();
    const c = await createCustomer(pool, owner, {
      name: '  Мурод  ',
      phone: '90 123 45 67',
      notes: 'Qo‘shni do‘kon',
    });
    expect(c).toMatchObject({
      name: 'Мурод',
      phone: '+998901234567',
      notes: 'Qo‘shni do‘kon',
      status: 'ACTIVE',
      balance: 0,
    });
    const { rows } = await system.query(
      'SELECT normalized_name, created_by FROM customers WHERE id = $1',
      [c.id],
    );
    expect(rows[0].normalized_name).toBe('murod');
    const audit = await system.query(
      "SELECT action FROM audit_logs WHERE business_id = $1 AND entity = 'customer'",
      [businessId],
    );
    expect(audit.rows).toEqual([{ action: 'customer.create' }]);
  });

  it('STAFF ham mijoz yarata oladi (customer.create)', async () => {
    const { staff } = await setup();
    expect((await createCustomer(pool, staff, { name: 'Ali' })).name).toBe('Ali');
  });

  it('Lotin va Kirill yozuvi bir xil mijoz hisoblanadi (dublikat)', async () => {
    const { owner } = await setup();
    await createCustomer(pool, owner, { name: 'Murod' });
    expect(await reasonOf(createCustomer(pool, owner, { name: 'Мурод' }))).toBe('LABEL_REQUIRED');
    expect(await reasonOf(createCustomer(pool, owner, { name: 'MUROD' }))).toBe('LABEL_REQUIRED');
  });

  it('bir xil ismli mijoz uchun yorliq talab qilinadi (TT §12); yorliq bilan yaratiladi', async () => {
    const { owner } = await setup();
    await createCustomer(pool, owner, { name: 'Ali' });
    expect(await reasonOf(createCustomer(pool, owner, { name: 'Ali' }))).toBe('LABEL_REQUIRED');
    const second = await createCustomer(pool, owner, { name: 'Ali', label: 'qo‘shni' });
    expect(second.label).toBe('qo‘shni');
    expect(await reasonOf(createCustomer(pool, owner, { name: 'ali', label: "QO'SHNI" }))).toBe(
      'DUPLICATE_IDENTITY',
    );
  });

  it('parallel ikkita bir xil mijoz: bittasi yaratiladi, ikkinchisi ConflictError', async () => {
    const { owner } = await setup();
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => createCustomer(pool, owner, { name: 'Parallel' })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results)
      if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(ConflictError);
  });

  it('noto‘g‘ri kiritma ValidationError', async () => {
    const { owner } = await setup();
    await expect(createCustomer(pool, owner, { name: '!!!' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(createCustomer(pool, owner, { name: 'Ali', phone: '123' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      createCustomer(pool, owner, { name: 'Ali', label: 'x'.repeat(51) }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('obuna tugagan biznesda mijoz yaratib bo‘lmaydi (read-only), o‘qish ishlaydi', async () => {
    const { owner, businessId } = await setup();
    const c = await createCustomer(pool, owner, { name: 'Oldin' });
    await system.query(
      "UPDATE subscriptions SET trial_ends_at = now() - interval '1 day' WHERE business_id = $1",
      [businessId],
    );
    await expect(createCustomer(pool, owner, { name: 'Keyin' })).rejects.toBeInstanceOf(
      SubscriptionExpiredError,
    );
    await expect(updateCustomer(pool, owner, c.id, { notes: 'x' })).rejects.toBeInstanceOf(
      SubscriptionExpiredError,
    );
    expect((await getCustomer(pool, owner, c.id)).name).toBe('Oldin');
    expect((await searchCustomers(pool, owner)).items).toHaveLength(1);
  });

  it('revoke qilingan xodimning eski access’i bilan yozib bo‘lmaydi', async () => {
    const { staff, ownerId, staffId, businessId } = await setup();
    await fx.revokeMember(pool, businessId, ownerId, staffId);
    await expect(createCustomer(pool, staff, { name: 'Hack' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('rol pasayganda eski access’dagi OWNER huquqi ishlamaydi (yangi rol DB’dan)', async () => {
    const { staff, businessId } = await setup();
    // staff.role = 'STAFF'; soxta OWNER access
    const forged: BusinessAccess = { ...staff, role: 'OWNER' };
    const c = await createCustomer(pool, staff, { name: 'Arxiv uchun' });
    await expect(archiveCustomer(pool, forged, c.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(businessId).toBeTruthy();
  });
});

describe('getCustomer / tenant isolation', () => {
  it('boshqa biznes mijozi NotFound (mavjudligi oshkor qilinmaydi)', async () => {
    const a = await setup();
    const b = await setup();
    const bc = await createCustomer(pool, b.owner, { name: 'Begona' });
    await expect(getCustomer(pool, a.owner, bc.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getCustomer(pool, a.owner, 'not-a-uuid')).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateCustomer(pool, a.owner, bc.id, { name: 'Hack' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(archiveCustomer(pool, a.owner, bc.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await searchCustomers(pool, a.owner)).items).toEqual([]);
    expect((await getCustomer(pool, b.owner, bc.id)).name).toBe('Begona');
  });
});

describe('updateCustomer', () => {
  it('maydonlarni o‘zgartiradi va tozalaydi, qolganlari saqlanadi', async () => {
    const { owner } = await setup();
    const c = await createCustomer(pool, owner, {
      name: 'Vali',
      phone: '901234567',
      notes: 'eslatma',
    });
    const u1 = await updateCustomer(pool, owner, c.id, { name: 'Valijon', notes: null });
    expect(u1).toMatchObject({ name: 'Valijon', phone: '+998901234567', notes: null });
    const u2 = await updateCustomer(pool, owner, c.id, { phone: '' });
    expect(u2.phone).toBeNull();
    expect(u2.name).toBe('Valijon');
  });

  it('boshqa mijoz bilan (ism, yorliq) to‘qnashsa ConflictError', async () => {
    const { owner } = await setup();
    await createCustomer(pool, owner, { name: 'Sardor' });
    const b = await createCustomer(pool, owner, { name: 'Sarvar' });
    expect(await reasonOf(updateCustomer(pool, owner, b.id, { name: 'Sardor' }))).toBe(
      'LABEL_REQUIRED',
    );
    const updated = await updateCustomer(pool, owner, b.id, { name: 'Sardor', label: 'ukasi' });
    expect(updated.label).toBe('ukasi');
  });

  it('o‘z nomini o‘zgartirmasdan saqlash to‘qnashuv hisoblanmaydi', async () => {
    const { owner } = await setup();
    const c = await createCustomer(pool, owner, { name: 'Bobur' });
    expect((await updateCustomer(pool, owner, c.id, { name: 'Bobur', notes: 'x' })).notes).toBe(
      'x',
    );
  });
});

describe('arxivlash', () => {
  it('faqat OWNER va faqat balans 0 bo‘lganda; qayta faollashtirish', async () => {
    const { owner, staff, businessId, ownerId } = await setup();
    const c = await createCustomer(pool, owner, { name: 'Arxiv' });
    await expect(archiveCustomer(pool, staff, c.id)).rejects.toBeInstanceOf(ForbiddenError);

    // Qarz qo'shamiz (xom SQL: ledger servisi keyingi vazifa)
    await fx.insertDebt(pool, businessId, ownerId, c.id, 5000);
    expect(await reasonOf(archiveCustomer(pool, owner, c.id))).toBe('BALANCE_NOT_ZERO');
    expect((await getCustomer(pool, owner, c.id)).status).toBe('ACTIVE');
  });

  it('0 balansli mijoz arxivlanadi, ro‘yxatdan chiqadi, qayta ochiladi; takroriy chaqiruv idempotent', async () => {
    const { owner, staff } = await setup();
    const c = await createCustomer(pool, owner, { name: 'Bo‘sh' });
    expect((await archiveCustomer(pool, owner, c.id)).status).toBe('ARCHIVED');
    expect((await archiveCustomer(pool, owner, c.id)).status).toBe('ARCHIVED');
    expect((await searchCustomers(pool, owner)).items).toEqual([]);
    expect(
      (await searchCustomers(pool, owner, { status: 'ARCHIVED' })).items.map((x) => x.id),
    ).toEqual([c.id]);
    await expect(unarchiveCustomer(pool, staff, c.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await unarchiveCustomer(pool, owner, c.id)).status).toBe('ACTIVE');
  });

  it('arxivdagi mijoz nomi bilan yangi mijoz yaratish mumkin; qayta ochishda to‘qnashuv aniqlanadi', async () => {
    const { owner } = await setup();
    const old = await createCustomer(pool, owner, { name: 'Takror' });
    await archiveCustomer(pool, owner, old.id);
    await createCustomer(pool, owner, { name: 'Takror' });
    expect(await reasonOf(unarchiveCustomer(pool, owner, old.id))).toBe('LABEL_REQUIRED');
  });
});

describe('searchCustomers', () => {
  async function seeded() {
    const s = await setup();
    const names = [
      'Murod',
      'Murodbek',
      'Мурод ака',
      'Ali',
      'Vali',
      'Sardor',
      'Gulnora',
      'O‘tkir',
      'Ғайрат',
    ];
    const created: Customer[] = [];
    for (const [i, name] of names.entries()) {
      created.push(
        await createCustomer(pool, s.owner, {
          name,
          label: name === 'Мурод ака' ? 'aka' : undefined,
          phone: i === 3 ? '+998909998877' : undefined,
        }),
      );
    }
    // Qarzlar: Ali 300, Sardor 100, Vali 100, Murod 50 (xom SQL)
    const debt = (name: string, amount: number) =>
      fx.insertDebt(
        pool,
        s.businessId,
        s.ownerId,
        created.find((c) => c.name === name)!.id,
        amount,
      );
    await debt('Ali', 300);
    await debt('Sardor', 100);
    await debt('Vali', 100);
    await debt('Murod', 50);
    return { ...s, created };
  }

  it('qidiruv Lotin/Kirill va qism bo‘yicha ishlaydi', async () => {
    const { owner } = await seeded();
    const names = async (q: string) =>
      (await searchCustomers(pool, owner, { q })).items.map((c) => c.name).toSorted();
    expect(await names('murod')).toEqual(['Murod', 'Murodbek', 'Мурод ака']);
    expect(await names('МУРОД')).toEqual(['Murod', 'Murodbek', 'Мурод ака']);
    expect(await names('gayrat')).toEqual([]);
    expect(await names("g'ayrat")).toEqual(['Ғайрат']);
    expect(await names('aka')).toEqual(['Мурод ака']); // yorliq bo'yicha
    expect(await names('99887')).toEqual(['Ali']); // telefon bo'yicha
    // Maxsus belgilar normallashtirishda tushib qoladi: LIKE joker belgilari (%, _) hech qachon so'rovga yetmaydi
    expect(await names('mu_od')).toEqual([]);
    expect(await names('%')).toHaveLength(9); // belgilardan iborat so'rov = filtr yo'q
    expect(await names('')).toHaveLength(9);
  });

  it('saralash: eng katta qarz, ism, eng yangi', async () => {
    const { owner } = await seeded();
    const debt = await searchCustomers(pool, owner, { sort: 'debt', limit: 4 });
    expect(debt.items.map((c) => c.balance)).toEqual([300, 100, 100, 50]);
    expect(debt.items[0]!.name).toBe('Ali');
    expect(
      debt.items
        .slice(1, 3)
        .map((c) => c.name)
        .toSorted(),
    ).toEqual(['Sardor', 'Vali']);
    expect(debt.items[3]!.name).toBe('Murod');

    const name = await searchCustomers(pool, owner, { sort: 'name', limit: 3 });
    expect(name.items.map((c) => c.name)).toEqual(['Ali', 'Ғайрат', 'Gulnora']); // ali < g'ayrat < gulnora

    const newest = await searchCustomers(pool, owner, { sort: 'newest', limit: 2 });
    expect(newest.items.map((c) => c.name)).toEqual(['Ғайрат', 'O‘tkir']);
  });

  it('faqat qarzdorlar', async () => {
    const { owner } = await seeded();
    const page = await searchCustomers(pool, owner, { onlyDebtors: true, sort: 'debt' });
    expect(page.items.map((c) => c.balance)).toEqual([300, 100, 100, 50]);
    expect(page.items.every((c) => c.balance > 0)).toBe(true);
  });

  for (const sort of ['debt', 'name', 'newest'] as const) {
    it(`kursor bilan sahifalash (${sort}): takrorlanmaydi va yo‘qolmaydi`, async () => {
      const { owner } = await seeded();
      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await searchCustomers(pool, owner, {
          sort,
          limit: 2,
          ...(cursor ? { cursor } : {}),
        });
        seen.push(...page.items.map((c) => c.id));
        cursor = page.nextCursor ?? undefined;
        pages++;
      } while (cursor && pages < 20);
      expect(pages).toBe(5);
      expect(new Set(seen).size).toBe(9);
      expect(seen).toHaveLength(9);
    });
  }

  it('boshqa saralashning yoki buzilgan kursor rad etiladi', async () => {
    const { owner } = await seeded();
    const page = await searchCustomers(pool, owner, { sort: 'debt', limit: 2 });
    await expect(
      searchCustomers(pool, owner, { sort: 'name', cursor: page.nextCursor! }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(searchCustomers(pool, owner, { cursor: 'garbage' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('limit chegaralanadi', async () => {
    const { owner } = await seeded();
    expect((await searchCustomers(pool, owner, { limit: 0 })).items).toHaveLength(1);
    expect((await searchCustomers(pool, owner, { limit: 9999 })).items).toHaveLength(9);
  });
});
