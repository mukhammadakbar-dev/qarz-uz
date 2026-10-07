import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import * as fc from 'fast-check';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_APP_URL, TEST_MIGRATOR_URL, TEST_SYSTEM_URL } from '../../../test/env.js';
import * as fx from '../../../test/fixtures.js';
import { createPool } from '../../db/pool.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  OverpaymentError,
  SubscriptionExpiredError,
  ValidationError,
} from '../../errors/index.js';
import { createLogger } from '../../observability/logger.js';
import { archiveCustomer, createCustomer } from '../customers/index.js';
import { resolveBusinessAccess, type BusinessAccess } from '../tenancy/index.js';
import {
  deleteEntry,
  findBalanceMismatches,
  getBalance,
  getBusinessSummary,
  getHistory,
  postAdjustment,
  postDebt,
  postPayment,
  previewDebt,
  previewPayment,
  reconcileBalances,
} from './index.js';

let pool: Pool;
let system: Pool;
let migrator: Pool;
beforeAll(() => {
  pool = createPool(TEST_APP_URL, { max: 12 });
  system = createPool(TEST_SYSTEM_URL, { max: 2 });
  migrator = createPool(TEST_MIGRATOR_URL, { max: 2 });
});
afterAll(async () => {
  await Promise.all([pool.end(), system.end(), migrator.end()]);
});

const key = () => randomUUID();

async function setup() {
  const ownerId = await fx.createUser(pool, 'owner');
  const staffId = await fx.createUser(pool, 'staff');
  const businessId = await fx.createBusiness(pool, ownerId);
  await fx.addMember(pool, businessId, ownerId, staffId);
  const owner = await resolveBusinessAccess(pool, { id: ownerId, activeBusinessId: businessId });
  const staff = await resolveBusinessAccess(pool, { id: staffId, activeBusinessId: businessId });
  const customer = await createCustomer(pool, owner, { name: `Mijoz ${randomUUID().slice(0, 8)}` });
  return { ownerId, staffId, businessId, owner, staff, customer };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

const debt = (
  ctx: Ctx,
  amount: number,
  over: Partial<Parameters<typeof postDebt>[2]> = {},
  who: BusinessAccess = ctx.owner,
) =>
  postDebt(pool, who, {
    customerId: ctx.customer.id,
    amount,
    idempotencyKey: key(),
    source: 'BOT',
    ...over,
  });
const pay = (
  ctx: Ctx,
  amount: number,
  over: Partial<Parameters<typeof postPayment>[2]> = {},
  who: BusinessAccess = ctx.owner,
) =>
  postPayment(pool, who, {
    customerId: ctx.customer.id,
    amount,
    idempotencyKey: key(),
    source: 'BOT',
    ...over,
  });

const sumDelta = async (businessId: string, customerId: string) =>
  Number(
    (
      await system.query(
        'SELECT COALESCE(sum(delta), 0)::bigint AS s FROM ledger_entries WHERE business_id = $1 AND customer_id = $2',
        [businessId, customerId],
      )
    ).rows[0].s,
  );
const rowCount = async (businessId: string, customerId: string) =>
  Number(
    (
      await system.query(
        'SELECT count(*)::int AS n FROM ledger_entries WHERE business_id = $1 AND customer_id = $2',
        [businessId, customerId],
      )
    ).rows[0].n,
  );

const reasonOf = async (p: Promise<unknown>) => {
  const e = await p.catch((x) => x);
  expect(e).toBeInstanceOf(ConflictError);
  return (e as ConflictError).details['reason'];
};

describe('AC-01 / AC-02: nasiya va to‘lov', () => {
  it('AC-01: "Murodbek 450 ming" → aynan bitta DEBT +450000', async () => {
    const ctx = await setup();
    const r = await debt(ctx, 450000);
    expect(r).toMatchObject({ balance: 450000, replayed: false });
    expect(r.entry).toMatchObject({
      type: 'DEBT',
      amount: 450000,
      delta: 450000,
      source: 'BOT',
      createdBy: ctx.ownerId,
    });
    expect(await rowCount(ctx.businessId, ctx.customer.id)).toBe(1);
  });

  it('AC-02: qoldiq 450000, 200 ming to‘lov → PAYMENT -200000, qoldiq 250000', async () => {
    const ctx = await setup();
    await debt(ctx, 450000);
    const r = await pay(ctx, 200000);
    expect(r.entry).toMatchObject({ type: 'PAYMENT', amount: 200000, delta: -200000 });
    expect(r.balance).toBe(250000);
    expect(await pay(ctx, 100000)).toMatchObject({ balance: 150000 });
    expect(await sumDelta(ctx.businessId, ctx.customer.id)).toBe(150000);
  });

  it('"kecha yozgan edim": occurred_at bir kun oldin, created_at hozir', async () => {
    const ctx = await setup();
    const r = await debt(ctx, 100000, { dateOffsetDays: -1, description: 'kechagi nasiya' });
    const dayMs = 86_400_000;
    expect(
      Math.abs(r.entry.createdAt.getTime() - r.entry.occurredAt.getTime() - dayMs),
    ).toBeLessThan(5000);
    expect(r.entry.description).toBe('kechagi nasiya');
  });

  it('xodim ham nasiya va to‘lov yoza oladi; createdBy xodim', async () => {
    const ctx = await setup();
    const r = await debt(ctx, 5000, {}, ctx.staff);
    expect(r.entry.createdBy).toBe(ctx.staffId);
    expect((await pay(ctx, 5000, {}, ctx.staff)).balance).toBe(0);
  });

  it('audit yoziladi', async () => {
    const ctx = await setup();
    const r = await debt(ctx, 7000);
    const { rows } = await system.query(
      "SELECT action, entity_id FROM audit_logs WHERE business_id = $1 AND entity = 'ledger_entry'",
      [ctx.businessId],
    );
    expect(rows).toEqual([{ action: 'ledger.debt', entity_id: r.entry.id }]);
  });
});

describe('summa va kiritma validatsiyasi', () => {
  it('noto‘g‘ri summalar ValidationError, hech narsa yozilmaydi', async () => {
    const ctx = await setup();
    for (const bad of [0, -1, 1.5, NaN, Infinity, 10_000_000_001, 2 ** 60]) {
      await expect(debt(ctx, bad), String(bad)).rejects.toBeInstanceOf(ValidationError);
      await expect(pay(ctx, bad), String(bad)).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await rowCount(ctx.businessId, ctx.customer.id)).toBe(0);
    expect((await debt(ctx, 10_000_000_000)).balance).toBe(10_000_000_000);
  });

  it('sana va kalit chegaralari', async () => {
    const ctx = await setup();
    await expect(debt(ctx, 1, { dateOffsetDays: 1 })).rejects.toBeInstanceOf(ValidationError);
    await expect(debt(ctx, 1, { dateOffsetDays: -366 })).rejects.toBeInstanceOf(ValidationError);
    await expect(debt(ctx, 1, { dateOffsetDays: -0.5 })).rejects.toBeInstanceOf(ValidationError);
    await expect(debt(ctx, 1, { idempotencyKey: '' })).rejects.toBeInstanceOf(ValidationError);
    await expect(debt(ctx, 1, { idempotencyKey: 'k'.repeat(129) })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(debt(ctx, 1, { description: 'x'.repeat(501) })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await debt(ctx, 1, { dateOffsetDays: -365 });
  });

  it('mavjud bo‘lmagan yoki noto‘g‘ri ID li mijoz: NotFound', async () => {
    const ctx = await setup();
    await expect(debt(ctx, 1, { customerId: randomUUID() })).rejects.toBeInstanceOf(NotFoundError);
    await expect(debt(ctx, 1, { customerId: 'xyz' })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('ortiqcha to‘lov HECH QACHON yozilmaydi (Q1)', () => {
  it('qarzdan ko‘p to‘lov rad etiladi, maxPayable qaytadi, ledger o‘zgarmaydi', async () => {
    const ctx = await setup();
    await debt(ctx, 100000);
    const err = await pay(ctx, 150000).catch((e) => e);
    expect(err).toBeInstanceOf(OverpaymentError);
    expect(err.maxPayable).toBe(100000);
    expect(await rowCount(ctx.businessId, ctx.customer.id)).toBe(1);
    expect(await getBalance(pool, ctx.owner, ctx.customer.id)).toBe(100000);
  });

  it('chegara: aynan qoldiq — mumkin, bir so‘m ortiq — yo‘q', async () => {
    const ctx = await setup();
    await debt(ctx, 100000);
    await expect(pay(ctx, 100001)).rejects.toBeInstanceOf(OverpaymentError);
    expect((await pay(ctx, 100000)).balance).toBe(0);
  });

  it('qarzi yo‘q mijozga to‘lov: maxPayable = 0', async () => {
    const ctx = await setup();
    const err = await pay(ctx, 1).catch((e) => e);
    expect(err).toBeInstanceOf(OverpaymentError);
    expect(err.maxPayable).toBe(0);
  });

  it('50 ta parallel to‘lov: aynan sig‘adigani o‘tadi, qolgani rad, qoldiq hech qachon manfiy emas', async () => {
    const ctx = await setup();
    await debt(ctx, 100000);
    const results = await Promise.allSettled(Array.from({ length: 50 }, () => pay(ctx, 10000)));
    const ok = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(10);
    expect(rejected).toHaveLength(40);
    for (const r of rejected) expect(r.reason).toBeInstanceOf(OverpaymentError);
    expect(await getBalance(pool, ctx.owner, ctx.customer.id)).toBe(0);
    expect(await sumDelta(ctx.businessId, ctx.customer.id)).toBe(0);
    expect(await rowCount(ctx.businessId, ctx.customer.id)).toBe(11);
  });

  it('ikki xodim bir vaqtda nasiya yozsa ikkalasi saqlanadi (yo‘qolgan yangilanish yo‘q)', async () => {
    const ctx = await setup();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => debt(ctx, 1000 + i, {}, i % 2 ? ctx.staff : ctx.owner)),
    );
    const expected = Array.from({ length: 20 }, (_, i) => 1000 + i).reduce((a, b) => a + b, 0);
    expect(await getBalance(pool, ctx.owner, ctx.customer.id)).toBe(expected);
    expect(await sumDelta(ctx.businessId, ctx.customer.id)).toBe(expected);
  });

  it('parallel nasiya va to‘lov aralashmasi: qoldiq ledger yig‘indisiga teng', async () => {
    const ctx = await setup();
    await debt(ctx, 50000);
    await Promise.allSettled([
      ...Array.from({ length: 15 }, () => pay(ctx, 7000)),
      ...Array.from({ length: 10 }, () => debt(ctx, 3000)),
    ]);
    const balance = await getBalance(pool, ctx.owner, ctx.customer.id);
    expect(balance).toBeGreaterThanOrEqual(0);
    expect(balance).toBe(await sumDelta(ctx.businessId, ctx.customer.id));
  });
});

describe('idempotentlik (AC-05)', () => {
  it('xuddi shu kalit ikkinchi marta: yangi yozuv yo‘q, avvalgisi qaytadi (replayed)', async () => {
    const ctx = await setup();
    const k = key();
    const first = await debt(ctx, 450000, { idempotencyKey: k });
    const second = await debt(ctx, 450000, { idempotencyKey: k });
    expect(second.replayed).toBe(true);
    expect(second.entry.id).toBe(first.entry.id);
    expect(second.balance).toBe(450000);
    expect(await rowCount(ctx.businessId, ctx.customer.id)).toBe(1);
    expect(await getBalance(pool, ctx.owner, ctx.customer.id)).toBe(450000);
  });

  it('replay keyingi yozuvlardan keyin ham joriy qoldiqni qaytaradi', async () => {
    const ctx = await setup();
    const k = key();
    await debt(ctx, 100000, { idempotencyKey: k });
    await pay(ctx, 30000);
    const again = await debt(ctx, 100000, { idempotencyKey: k });
    expect(again.replayed).toBe(true);
    expect(again.balance).toBe(70000);
  });

  it('AC-05: 10 ta parallel bir xil so‘rov → 1 ta yozuv, hammasi bir xil entry qaytaradi', async () => {
    const ctx = await setup();
    const k = key();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => debt(ctx, 250000, { idempotencyKey: k })),
    );
    expect(new Set(results.map((r) => r.entry.id)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await rowCount(ctx.businessId, ctx.customer.id)).toBe(1);
    expect(await getBalance(pool, ctx.owner, ctx.customer.id)).toBe(250000);
  });

  it('to‘lov uchun ham: parallel takroriy to‘lov ikki marta yechilmaydi', async () => {
    const ctx = await setup();
    await debt(ctx, 100000);
    const k = key();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => pay(ctx, 60000, { idempotencyKey: k })),
    );
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await getBalance(pool, ctx.owner, ctx.customer.id)).toBe(40000);
  });

  it('kalit boshqa summa, tur yoki mijoz uchun ishlatilsa ConflictError', async () => {
    const ctx = await setup();
    const other = await createCustomer(pool, ctx.owner, {
      name: `Boshqa ${randomUUID().slice(0, 6)}`,
    });
    const k = key();
    await debt(ctx, 1000, { idempotencyKey: k });
    expect(await reasonOf(debt(ctx, 2000, { idempotencyKey: k }))).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await reasonOf(pay(ctx, 1000, { idempotencyKey: k }))).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await reasonOf(debt(ctx, 1000, { idempotencyKey: k, customerId: other.id }))).toBe(
      'IDEMPOTENCY_KEY_REUSED',
    );
    expect(await rowCount(ctx.businessId, ctx.customer.id)).toBe(1);
  });

  it('bir xil kalit turli mijozlarga parallel: faqat bittasi yoziladi', async () => {
    const ctx = await setup();
    const other = await createCustomer(pool, ctx.owner, {
      name: `Boshqa ${randomUUID().slice(0, 6)}`,
    });
    const k = key();
    const results = await Promise.allSettled([
      debt(ctx, 1000, { idempotencyKey: k }),
      debt(ctx, 1000, { idempotencyKey: k, customerId: other.id }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const total =
      (await rowCount(ctx.businessId, ctx.customer.id)) +
      (await rowCount(ctx.businessId, other.id));
    expect(total).toBe(1);
  });

  it('kalit biznes ichida noyob: boshqa biznes bir xil kalitdan foydalana oladi', async () => {
    const a = await setup();
    const b = await setup();
    const k = key();
    await debt(a, 1000, { idempotencyKey: k });
    expect((await debt(b, 1000, { idempotencyKey: k })).replayed).toBe(false);
  });
});

describe('ruxsatlar', () => {
  it('ADJUSTMENT faqat OWNER; sabab majburiy; qoldiqni manfiy qila olmaydi', async () => {
    const ctx = await setup();
    await debt(ctx, 100000);
    const adj = (
      amount: number,
      who: BusinessAccess,
      description: string | null = 'inventarizatsiya',
    ) =>
      postAdjustment(pool, who, {
        customerId: ctx.customer.id,
        amount,
        description,
        idempotencyKey: key(),
        source: 'MINIAPP',
      });
    await expect(adj(-1000, ctx.staff)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(adj(-1000, ctx.owner, null)).rejects.toBeInstanceOf(ValidationError);
    await expect(adj(-1000, ctx.owner, '   ')).rejects.toBeInstanceOf(ValidationError);
    await expect(adj(0, ctx.owner)).rejects.toBeInstanceOf(ValidationError);
    expect(await reasonOf(adj(-100001, ctx.owner))).toBe('ADJUSTMENT_WOULD_OVERDRAW');
    expect((await adj(-50000, ctx.owner)).balance).toBe(50000);
    expect((await adj(25000, ctx.owner)).balance).toBe(75000);
    expect(await sumDelta(ctx.businessId, ctx.customer.id)).toBe(75000);
  });

  it('revoke qilingan xodimning eski access’i bilan yozib bo‘lmaydi', async () => {
    const ctx = await setup();
    await debt(ctx, 1000, {}, ctx.staff);
    await fx.revokeMember(pool, ctx.businessId, ctx.ownerId, ctx.staffId);
    await expect(debt(ctx, 1000, {}, ctx.staff)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(pay(ctx, 1, {}, ctx.staff)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await rowCount(ctx.businessId, ctx.customer.id)).toBe(1);
  });

  it('soxta OWNER access (eski/yolg‘on rol) DB’dagi haqiqiy rol bilan almashtiriladi', async () => {
    const ctx = await setup();
    const forged: BusinessAccess = { ...ctx.staff, role: 'OWNER' };
    await expect(
      postAdjustment(pool, forged, {
        customerId: ctx.customer.id,
        amount: 100,
        description: 'x',
        idempotencyKey: key(),
        source: 'BOT',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('arxivdagi mijozga yozib bo‘lmaydi', async () => {
    const ctx = await setup();
    await archiveCustomer(pool, ctx.owner, ctx.customer.id);
    expect(await reasonOf(debt(ctx, 1000))).toBe('CUSTOMER_ARCHIVED');
  });

  it('obuna tugagan (EXPIRED): yozuvlar bloklanadi, o‘qish ishlaydi (ADR-0005)', async () => {
    const ctx = await setup();
    const r = await debt(ctx, 5000);
    await system.query(
      "UPDATE subscriptions SET trial_ends_at = now() - interval '1 second' WHERE business_id = $1",
      [ctx.businessId],
    );
    await expect(debt(ctx, 1)).rejects.toBeInstanceOf(SubscriptionExpiredError);
    await expect(pay(ctx, 1)).rejects.toBeInstanceOf(SubscriptionExpiredError);
    await expect(
      deleteEntry(pool, ctx.owner, { entryId: r.entry.id, idempotencyKey: key(), source: 'BOT' }),
    ).rejects.toBeInstanceOf(SubscriptionExpiredError);
    expect(await getBalance(pool, ctx.owner, ctx.customer.id)).toBe(5000);
    expect((await getHistory(pool, ctx.owner, ctx.customer.id)).items).toHaveLength(1);
    // To'lov qilinsa (paid_until) — yana yozish mumkin
    await system.query(
      "UPDATE subscriptions SET paid_until = now() + interval '30 days' WHERE business_id = $1",
      [ctx.businessId],
    );
    expect((await debt(ctx, 1)).balance).toBe(5001);
  });
});

describe('AC-06: tenant isolation (servis darajasida)', () => {
  it('A biznes B mijoziga yoza olmaydi, ko‘ra olmaydi', async () => {
    const a = await setup();
    const b = await setup();
    await debt(b, 9000);
    const foreign = b.customer.id;
    await expect(
      postDebt(pool, a.owner, {
        customerId: foreign,
        amount: 1,
        idempotencyKey: key(),
        source: 'BOT',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      postPayment(pool, a.owner, {
        customerId: foreign,
        amount: 1,
        idempotencyKey: key(),
        source: 'BOT',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(getBalance(pool, a.owner, foreign)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getHistory(pool, a.owner, foreign)).rejects.toBeInstanceOf(NotFoundError);
    await expect(previewPayment(pool, a.owner, foreign, 1)).rejects.toBeInstanceOf(NotFoundError);
    expect(await getBalance(pool, b.owner, foreign)).toBe(9000);
    expect(await rowCount(b.businessId, foreign)).toBe(1);
  });

  it('A biznes B yozuvini o‘chira olmaydi', async () => {
    const a = await setup();
    const b = await setup();
    const r = await debt(b, 9000);
    await expect(
      deleteEntry(pool, a.owner, { entryId: r.entry.id, idempotencyKey: key(), source: 'BOT' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await getBalance(pool, b.owner, b.customer.id)).toBe(9000);
  });

  it('A biznes B ning idempotency kalitini “ko‘rmaydi” (kalit ma’lumot sizdirmaydi)', async () => {
    const a = await setup();
    const b = await setup();
    const k = key();
    await debt(b, 777, { idempotencyKey: k });
    const r = await debt(a, 1, { idempotencyKey: k });
    expect(r.replayed).toBe(false);
    expect(r.entry.amount).toBe(1);
  });
});

describe('storno (o‘chirish), Q2/Q3', () => {
  const del = (
    ctx: Ctx,
    entryId: string,
    over: Partial<Parameters<typeof deleteEntry>[2]> = {},
    who: BusinessAccess = ctx.owner,
  ) => deleteEntry(pool, who, { entryId, idempotencyKey: key(), source: 'BOT', ...over });

  it('nasiyani o‘chirish: teskari ADJUSTMENT, qoldiq 0, tarixda ikkala yozuv saqlanadi', async () => {
    const ctx = await setup();
    const d = await debt(ctx, 450000);
    const r = await del(ctx, d.entry.id, { reason: 'xato yozilgan' });
    expect(r.balance).toBe(0);
    expect(r.entry).toMatchObject({
      type: 'ADJUSTMENT',
      amount: -450000,
      delta: -450000,
      reversesEntryId: d.entry.id,
      description: 'xato yozilgan',
    });
    expect(r.original.id).toBe(d.entry.id);
    expect(await rowCount(ctx.businessId, ctx.customer.id)).toBe(2);
    expect(await sumDelta(ctx.businessId, ctx.customer.id)).toBe(0);
  });

  it('to‘lovni o‘chirish qoldiqni qaytaradi', async () => {
    const ctx = await setup();
    await debt(ctx, 450000);
    const p = await pay(ctx, 200000);
    expect((await del(ctx, p.entry.id)).balance).toBe(450000);
  });

  it('ikkinchi marta o‘chirish: ALREADY_REVERSED; stornoni o‘chirib bo‘lmaydi', async () => {
    const ctx = await setup();
    const d = await debt(ctx, 1000);
    const s = await del(ctx, d.entry.id);
    expect(await reasonOf(del(ctx, d.entry.id))).toBe('ALREADY_REVERSED');
    expect(await reasonOf(del(ctx, s.entry.id))).toBe('CANNOT_REVERSE_REVERSAL');
    expect(await getBalance(pool, ctx.owner, ctx.customer.id)).toBe(0);
  });

  it('keyingi to‘lovi bor nasiyani o‘chirish rad etiladi; avval to‘lovni o‘chirsa bo‘ladi', async () => {
    const ctx = await setup();
    const d = await debt(ctx, 100000);
    const p = await pay(ctx, 70000);
    expect(await reasonOf(del(ctx, d.entry.id))).toBe('REVERSAL_WOULD_OVERDRAW');
    expect(await getBalance(pool, ctx.owner, ctx.customer.id)).toBe(30000);
    await del(ctx, p.entry.id);
    expect((await del(ctx, d.entry.id)).balance).toBe(0);
  });

  it('o‘chirish takroriy chaqiruvda idempotent', async () => {
    const ctx = await setup();
    const d = await debt(ctx, 1000);
    const k = key();
    const first = await del(ctx, d.entry.id, { idempotencyKey: k });
    const again = await del(ctx, d.entry.id, { idempotencyKey: k });
    expect(again.replayed).toBe(true);
    expect(again.entry.id).toBe(first.entry.id);
    expect(again.notifyOwner).toBe(false);
    const other = await debt(ctx, 500);
    expect(await reasonOf(del(ctx, other.entry.id, { idempotencyKey: k }))).toBe(
      'IDEMPOTENCY_KEY_REUSED',
    );
  });

  it('parallel o‘chirish: faqat bitta storno yoziladi', async () => {
    const ctx = await setup();
    const d = await debt(ctx, 5000);
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => del(ctx, d.entry.id)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await rowCount(ctx.businessId, ctx.customer.id)).toBe(2);
    expect(await getBalance(pool, ctx.owner, ctx.customer.id)).toBe(0);
  });

  it('xodim o‘chira oladi (Q2); egasiga xabar kerak (D-b), sozlama o‘chirilsa — yo‘q', async () => {
    const ctx = await setup();
    const a = await debt(ctx, 1000);
    const b = await debt(ctx, 2000);
    const c = await debt(ctx, 3000);
    expect((await del(ctx, a.entry.id, {}, ctx.staff)).notifyOwner).toBe(true);
    expect((await del(ctx, b.entry.id, {}, ctx.owner)).notifyOwner).toBe(false);
    await system.query('UPDATE businesses SET notify_owner_on_delete = false WHERE id = $1', [
      ctx.businessId,
    ]);
    expect((await del(ctx, c.entry.id, {}, ctx.staff)).notifyOwner).toBe(false);
  });

  it('mavjud bo‘lmagan yoki noto‘g‘ri ID: NotFound', async () => {
    const ctx = await setup();
    await expect(del(ctx, randomUUID())).rejects.toBeInstanceOf(NotFoundError);
    await expect(del(ctx, 'xyz')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('arxivdagi mijoz yozuvini o‘chirib bo‘lmaydi (avval arxivdan chiqarish kerak)', async () => {
    const ctx = await setup();
    await debt(ctx, 1000);
    const p = await pay(ctx, 1000); // qoldiq 0 → arxivlash mumkin
    await archiveCustomer(pool, ctx.owner, ctx.customer.id);
    expect(await reasonOf(del(ctx, p.entry.id))).toBe('CUSTOMER_ARCHIVED');
    expect(await getBalance(pool, ctx.owner, ctx.customer.id)).toBe(0);
  });

  it('revoke qilingan xodim o‘chira olmaydi', async () => {
    const ctx = await setup();
    const d = await debt(ctx, 1000);
    await fx.revokeMember(pool, ctx.businessId, ctx.ownerId, ctx.staffId);
    await expect(del(ctx, d.entry.id, {}, ctx.staff)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('audit: o‘chirish kim tomonidan va sababi bilan yoziladi', async () => {
    const ctx = await setup();
    const d = await debt(ctx, 1000);
    await del(ctx, d.entry.id, { reason: 'adashdim' }, ctx.staff);
    const { rows } = await system.query(
      "SELECT actor_user_id, after FROM audit_logs WHERE business_id = $1 AND action = 'ledger.entry.delete'",
      [ctx.businessId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_user_id).toBe(ctx.staffId);
    expect(rows[0].after.reason).toBe('adashdim');
  });
});

describe('preview (yozmaydi)', () => {
  it('previewPayment: ruxsat etilgan, ortiqcha, nol qarz', async () => {
    const ctx = await setup();
    await debt(ctx, 450000);
    expect(await previewPayment(pool, ctx.owner, ctx.customer.id, 200000)).toEqual({
      balance: 450000,
      maxPayable: 450000,
      allowed: true,
      balanceAfter: 250000,
    });
    expect(await previewPayment(pool, ctx.owner, ctx.customer.id, 450001)).toMatchObject({
      allowed: false,
      balanceAfter: null,
      maxPayable: 450000,
    });
    expect(await previewPayment(pool, ctx.owner, ctx.customer.id, 0)).toMatchObject({
      allowed: false,
    });
    expect(await previewPayment(pool, ctx.owner, ctx.customer.id, 1.5)).toMatchObject({
      allowed: false,
    });
    expect(await previewDebt(pool, ctx.owner, ctx.customer.id, 50000)).toEqual({
      balance: 450000,
      balanceAfter: 500000,
    });
    expect(await rowCount(ctx.businessId, ctx.customer.id)).toBe(1);
  });
});

describe('tarix (TT §33)', () => {
  it('qoldiq (running balance) seq tartibida, o‘chirilgan va storno belgilari bilan', async () => {
    const ctx = await setup();
    await debt(ctx, 450000);
    await pay(ctx, 200000);
    const last = await pay(ctx, 100000);
    const s = await deleteEntry(pool, ctx.staff, {
      entryId: last.entry.id,
      idempotencyKey: key(),
      source: 'BOT',
      reason: 'xato',
    });

    const { items, nextCursor } = await getHistory(pool, ctx.owner, ctx.customer.id);
    expect(nextCursor).toBeNull();
    expect(items.map((i) => [i.type, i.delta, i.runningBalance])).toEqual([
      ['ADJUSTMENT', 100000, 250000],
      ['PAYMENT', -100000, 150000],
      ['PAYMENT', -200000, 250000],
      ['DEBT', 450000, 450000],
    ]);
    expect(items[0]).toMatchObject({ id: s.entry.id, isReversal: true, reversedBy: null });
    expect(items[1]).toMatchObject({
      id: last.entry.id,
      isReversal: false,
      reversedBy: s.entry.id,
    });
    expect(items[2]!.reversedBy).toBeNull();
    expect(items[0]!.createdByName).toBe('staff');
  });

  it('kursor bilan sahifalash: takrorlanmaydi, yo‘qolmaydi', async () => {
    const ctx = await setup();
    for (let i = 1; i <= 7; i++) await debt(ctx, i * 100);
    const seen: number[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await getHistory(pool, ctx.owner, ctx.customer.id, {
        limit: 3,
        ...(cursor ? { cursor } : {}),
      });
      seen.push(...page.items.map((i) => i.amount));
      cursor = page.nextCursor ?? undefined;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toEqual([700, 600, 500, 400, 300, 200, 100]);
  });

  it('qoldiq sahifa chegarasida ham to‘g‘ri (butun tarix bo‘yicha hisoblanadi)', async () => {
    const ctx = await setup();
    await debt(ctx, 1000);
    await debt(ctx, 2000);
    await debt(ctx, 3000);
    const page = await getHistory(pool, ctx.owner, ctx.customer.id, { limit: 1 });
    expect(page.items[0]!.runningBalance).toBe(6000);
    const next = await getHistory(pool, ctx.owner, ctx.customer.id, {
      limit: 1,
      cursor: page.nextCursor!,
    });
    expect(next.items[0]!.runningBalance).toBe(3000);
  });

  it('buzilgan kursor ValidationError', async () => {
    const ctx = await setup();
    await expect(
      getHistory(pool, ctx.owner, ctx.customer.id, { cursor: 'garbage' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      getHistory(pool, ctx.owner, ctx.customer.id, {
        cursor: Buffer.from('{"before":"1; DROP"}').toString('base64url'),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('dashboard (TT §31)', () => {
  it('jami qarz, qarzdorlar soni, bugungi operatsiyalar (storno hisoblanmaydi)', async () => {
    const ctx = await setup();
    const c2 = await createCustomer(pool, ctx.owner, {
      name: `Ikkinchi ${randomUUID().slice(0, 6)}`,
    });
    const c3 = await createCustomer(pool, ctx.owner, {
      name: `Uchinchi ${randomUUID().slice(0, 6)}`,
    });
    await debt(ctx, 450000);
    await postDebt(pool, ctx.owner, {
      customerId: c2.id,
      amount: 250000,
      idempotencyKey: key(),
      source: 'BOT',
    });
    const d3 = await postDebt(pool, ctx.owner, {
      customerId: c3.id,
      amount: 5000,
      idempotencyKey: key(),
      source: 'BOT',
    });
    await pay(ctx, 200000);
    await deleteEntry(pool, ctx.owner, {
      entryId: d3.entry.id,
      idempotencyKey: key(),
      source: 'BOT',
    });
    expect(await getBusinessSummary(pool, ctx.owner)).toEqual({
      totalDebt: 250000 + 250000,
      debtorsCount: 2,
      todayOperations: 4,
    });
  });

  it('boshqa biznes ma’lumoti hisobga olinmaydi', async () => {
    const a = await setup();
    const b = await setup();
    await debt(b, 999999);
    expect(await getBusinessSummary(pool, a.owner)).toEqual({
      totalDebt: 0,
      debtorsCount: 0,
      todayOperations: 0,
    });
  });
});

describe('reconciliation', () => {
  it('normal holatda nomuvofiqlik yo‘q', async () => {
    const ctx = await setup();
    await debt(ctx, 1000);
    await pay(ctx, 400);
    const mine = (await findBalanceMismatches(system)).filter(
      (m) => m.businessId === ctx.businessId,
    );
    expect(mine).toEqual([]);
  });

  it('proyeksiya qo‘lda buzilsa aniqlanadi va log’ga yoziladi (avtomatik tuzatilmaydi)', async () => {
    const ctx = await setup();
    await debt(ctx, 1000);
    // Faqat egasi (migrator) buzishi mumkin: ilova rollari yoza olmaydi
    await migrator.query(
      'UPDATE customer_balances SET balance = balance + 5 WHERE customer_id = $1',
      [ctx.customer.id],
    );
    const lines: Record<string, unknown>[] = [];
    const logger = createLogger(
      { logLevel: 'info', isProduction: true, env: 'test' },
      new Writable({ write: (c, _e, cb) => (lines.push(JSON.parse(String(c))), cb()) }),
    );
    const mismatches = (await reconcileBalances(system, logger)).filter(
      (m) => m.businessId === ctx.businessId,
    );
    expect(mismatches).toEqual([
      { customerId: ctx.customer.id, businessId: ctx.businessId, projected: 1005, ledgerSum: 1000 },
    ]);
    expect(
      lines.some((l) => l['level'] === 'error' && String(l['msg']).includes('NOMOSLIGI')),
    ).toBe(true);
    expect(await getBalance(pool, ctx.owner, ctx.customer.id)).toBe(1005); // tuzatilmagan
    await migrator.query(
      'UPDATE customer_balances SET balance = balance - 5 WHERE customer_id = $1',
      [ctx.customer.id],
    );
  });
});

describe('property: tasodifiy operatsiyalar ketma-ketligi modelga mos (fast-check)', () => {
  type Op =
    | { kind: 'debt'; amount: number }
    | { kind: 'pay'; amount: number }
    | { kind: 'delete'; pick: number };
  const opArb: fc.Arbitrary<Op> = fc.oneof(
    fc.record({ kind: fc.constant('debt' as const), amount: fc.integer({ min: 1, max: 1000 }) }),
    fc.record({ kind: fc.constant('pay' as const), amount: fc.integer({ min: 1, max: 1500 }) }),
    fc.record({ kind: fc.constant('delete' as const), pick: fc.nat(1000) }),
  );

  it('qoldiq doim modelga teng, ≥ 0 va SUM(delta) ga teng', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 14 }), async (ops) => {
        const ctx = await setup();
        let balance = 0;
        const live: { id: string; delta: number }[] = []; // o'chirilmagan, storno bo'lmagan yozuvlar
        const reversed: { id: string; delta: number }[] = [];

        for (const op of ops) {
          if (op.kind === 'debt') {
            const r = await debt(ctx, op.amount);
            balance += op.amount;
            live.push({ id: r.entry.id, delta: op.amount });
          } else if (op.kind === 'pay') {
            if (op.amount > balance) {
              await expect(pay(ctx, op.amount)).rejects.toBeInstanceOf(OverpaymentError);
            } else {
              const r = await pay(ctx, op.amount);
              balance -= op.amount;
              live.push({ id: r.entry.id, delta: -op.amount });
            }
          } else if (live.length > 0) {
            const target = live[op.pick % live.length]!;
            if (balance - target.delta < 0) {
              expect(
                await reasonOf(
                  deleteEntry(pool, ctx.staff, {
                    entryId: target.id,
                    idempotencyKey: key(),
                    source: 'BOT',
                  }),
                ),
              ).toBe('REVERSAL_WOULD_OVERDRAW');
            } else {
              await deleteEntry(pool, ctx.staff, {
                entryId: target.id,
                idempotencyKey: key(),
                source: 'BOT',
              });
              balance -= target.delta;
              live.splice(live.indexOf(target), 1);
              reversed.push(target);
            }
          }
          expect(await getBalance(pool, ctx.owner, ctx.customer.id)).toBe(balance);
        }
        expect(balance).toBeGreaterThanOrEqual(0);
        expect(await sumDelta(ctx.businessId, ctx.customer.id)).toBe(balance);
        for (const r of reversed) {
          expect(
            await reasonOf(
              deleteEntry(pool, ctx.owner, { entryId: r.id, idempotencyKey: key(), source: 'BOT' }),
            ),
          ).toBe('ALREADY_REVERSED');
        }
      }),
      { numRuns: 25 },
    );
  }, 120_000);
});
