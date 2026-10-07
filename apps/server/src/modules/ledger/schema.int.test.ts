import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_APP_URL, TEST_MIGRATOR_URL, TEST_SYSTEM_URL } from '../../../test/env.js';
import * as fx from '../../../test/fixtures.js';
import { createPool } from '../../db/pool.js';
import { withTenant } from '../../db/tenant.js';

/**
 * DB darajasidagi himoya: servis qatlamisiz, xom SQL bilan. Ilovadagi xato bo'lsa ham
 * invariantlar saqlanishini isbotlaydi (ADR-0002).
 */

let app: Pool;
let system: Pool;
let migrator: Pool;
let owner: string;
let biz: string;
let other: string;
let otherBiz: string;

beforeAll(async () => {
  app = createPool(TEST_APP_URL, { max: 6 });
  system = createPool(TEST_SYSTEM_URL, { max: 2 });
  migrator = createPool(TEST_MIGRATOR_URL, { max: 2 });
  owner = await fx.createUser(app, 'owner');
  biz = await fx.createBusiness(app, owner);
  other = await fx.createUser(app, 'other');
  otherBiz = await fx.createBusiness(app, other);
});
afterAll(async () => {
  await Promise.all([app.end(), system.end(), migrator.end()]);
});

const CHECK = '23514';
const UNIQUE = '23505';
const FK = '23503';
const INTEGRITY = '23000';
const DENIED = '42501';

async function pgCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

const inBiz = <T>(fn: (c: PoolClient) => Promise<T>, businessId = biz, userId = owner) =>
  withTenant(app, { businessId, userId }, fn);

let keySeq = 0;
async function insertEntry(
  c: PoolClient,
  customerId: string,
  type: 'DEBT' | 'PAYMENT' | 'ADJUSTMENT',
  amount: number,
  extra: { reverses?: string; businessId?: string; occurredSql?: string; key?: string } = {},
) {
  const { rows } = await c.query<{ id: string; delta: string }>(
    `INSERT INTO ledger_entries
       (business_id, customer_id, type, amount, created_by, source, idempotency_key, reverses_entry_id, occurred_at)
     VALUES ($1, $2, $3, $4, $5, 'BOT', $6, $7, ${extra.occurredSql ?? 'now()'})
     RETURNING id, delta`,
    [
      extra.businessId ?? biz,
      customerId,
      type,
      amount,
      owner,
      extra.key ?? `k-${keySeq++}-${randomUUID()}`,
      extra.reverses ?? null,
    ],
  );
  return rows[0]!;
}

const balanceOf = async (customerId: string, businessId = biz, userId = owner) =>
  Number(
    (
      await withTenant(app, { businessId, userId }, (c) =>
        c.query<{ balance: string }>(
          'SELECT balance FROM customer_balances WHERE customer_id = $1',
          [customerId],
        ),
      )
    ).rows[0]!.balance,
  );

describe('customers va balans proyeksiyasi', () => {
  it('yangi mijoz uchun 0 balans qatori avtomatik yaratiladi', async () => {
    const c = await fx.insertCustomer(app, biz, owner, 'Yangi');
    expect(await balanceOf(c)).toBe(0);
  });

  it('DEBT va PAYMENT balansni trigger orqali yangilaydi, delta generated', async () => {
    const c = await fx.insertCustomer(app, biz, owner);
    const debt = await inBiz((cl) => insertEntry(cl, c, 'DEBT', 450000));
    expect(debt.delta).toBe('450000');
    expect(await balanceOf(c)).toBe(450000);
    const pay = await inBiz((cl) => insertEntry(cl, c, 'PAYMENT', 200000));
    expect(pay.delta).toBe('-200000');
    expect(await balanceOf(c)).toBe(250000);
    const adj = await inBiz((cl) => insertEntry(cl, c, 'ADJUSTMENT', -50000));
    expect(adj.delta).toBe('-50000');
    expect(await balanceOf(c)).toBe(200000);
  });

  it('TT §23: balans = SUM(delta)', async () => {
    const c = await fx.insertCustomer(app, biz, owner);
    await inBiz(async (cl) => {
      await insertEntry(cl, c, 'DEBT', 450000);
      await insertEntry(cl, c, 'PAYMENT', 200000);
      await insertEntry(cl, c, 'PAYMENT', 100000);
    });
    const { rows } = await inBiz((cl) =>
      cl.query('SELECT sum(delta)::bigint AS s FROM ledger_entries WHERE customer_id = $1', [c]),
    );
    expect(Number(rows[0].s)).toBe(150000);
    expect(await balanceOf(c)).toBe(150000);
  });

  it('ortiqcha to‘lov DB darajasida rad etiladi va hech narsa yozilmaydi (Q1)', async () => {
    const c = await fx.insertCustomer(app, biz, owner);
    await inBiz((cl) => insertEntry(cl, c, 'DEBT', 100000));
    const code = await pgCode(inBiz((cl) => insertEntry(cl, c, 'PAYMENT', 100001)));
    expect(code).toBe(CHECK);
    expect(await balanceOf(c)).toBe(100000);
    const { rowCount } = await inBiz((cl) =>
      cl.query("SELECT 1 FROM ledger_entries WHERE customer_id = $1 AND type = 'PAYMENT'", [c]),
    );
    expect(rowCount).toBe(0);
  });

  it('qarzi yo‘q mijozga to‘lov va manfiy ADJUSTMENT rad etiladi', async () => {
    const c = await fx.insertCustomer(app, biz, owner);
    expect(await pgCode(inBiz((cl) => insertEntry(cl, c, 'PAYMENT', 1)))).toBe(CHECK);
    expect(await pgCode(inBiz((cl) => insertEntry(cl, c, 'ADJUSTMENT', -1)))).toBe(CHECK);
  });

  it('ilova roli balansga yoza olmaydi (INSERT/UPDATE/DELETE)', async () => {
    const c = await fx.insertCustomer(app, biz, owner);
    for (const sql of [
      `UPDATE customer_balances SET balance = 999999999 WHERE customer_id = '${c}'`,
      `DELETE FROM customer_balances WHERE customer_id = '${c}'`,
      `INSERT INTO customer_balances (customer_id, business_id, balance) VALUES ('${randomUUID()}', '${biz}', 1)`,
    ]) {
      expect(await pgCode(inBiz((cl) => cl.query(sql))), sql).toBe(DENIED);
    }
    expect(
      await pgCode(
        system.query(`UPDATE customer_balances SET balance = 1 WHERE customer_id = '${c}'`),
      ),
    ).toBe(DENIED);
  });
});

describe('ledger o‘zgarmasligi', () => {
  it('UPDATE/DELETE: app roliga grant yo‘q, egasiga trigger to‘sqinlik qiladi, TRUNCATE ham', async () => {
    const c = await fx.insertCustomer(app, biz, owner);
    await inBiz((cl) => insertEntry(cl, c, 'DEBT', 1000));
    expect(
      await pgCode(
        inBiz((cl) => cl.query('UPDATE ledger_entries SET amount = 1 WHERE customer_id = $1', [c])),
      ),
    ).toBe(DENIED);
    expect(
      await pgCode(
        inBiz((cl) => cl.query('DELETE FROM ledger_entries WHERE customer_id = $1', [c])),
      ),
    ).toBe(DENIED);
    expect(await pgCode(system.query('DELETE FROM ledger_entries'))).toBe(DENIED);
    expect(await pgCode(migrator.query('UPDATE ledger_entries SET amount = 1'))).toBe(INTEGRITY);
    expect(await pgCode(migrator.query('DELETE FROM ledger_entries'))).toBe(INTEGRITY);
    expect(await pgCode(migrator.query('TRUNCATE ledger_entries'))).toBe(INTEGRITY);
    expect(await balanceOf(c)).toBe(1000);
  });
});

describe('summa va sana cheklovlari', () => {
  it('noto‘g‘ri summalar CHECK bilan rad etiladi', async () => {
    const c = await fx.insertCustomer(app, biz, owner);
    const bad: [string, number][] = [
      ['DEBT', 0],
      ['DEBT', -5],
      ['PAYMENT', 0],
      ['PAYMENT', -5],
      ['DEBT', 10_000_000_001],
      ['ADJUSTMENT', 0],
      ['ADJUSTMENT', 10_000_000_001],
    ];
    for (const [type, amount] of bad) {
      expect(
        await pgCode(inBiz((cl) => insertEntry(cl, c, type as 'DEBT', amount))),
        `${type} ${amount}`,
      ).toBe(CHECK);
    }
    await inBiz((cl) => insertEntry(cl, c, 'DEBT', 10_000_000_000));
    expect(await balanceOf(c)).toBe(10_000_000_000);
  });

  it('occurred_at kelajakda yoki 365 kundan oldin bo‘la olmaydi', async () => {
    const c = await fx.insertCustomer(app, biz, owner);
    expect(
      await pgCode(
        inBiz((cl) => insertEntry(cl, c, 'DEBT', 1, { occurredSql: "now() + interval '1 hour'" })),
      ),
    ).toBe(CHECK);
    expect(
      await pgCode(
        inBiz((cl) =>
          insertEntry(cl, c, 'DEBT', 1, { occurredSql: "now() - interval '366 days'" }),
        ),
      ),
    ).toBe(CHECK);
    await inBiz((cl) => insertEntry(cl, c, 'DEBT', 1, { occurredSql: "now() - interval '1 day'" }));
  });

  it('idempotency_key (biznes ichida) takrorlanmaydi, boshqa biznesda mumkin', async () => {
    const c = await fx.insertCustomer(app, biz, owner);
    await inBiz((cl) => insertEntry(cl, c, 'DEBT', 1, { key: 'same-key' }));
    expect(await pgCode(inBiz((cl) => insertEntry(cl, c, 'DEBT', 1, { key: 'same-key' })))).toBe(
      UNIQUE,
    );
    const oc = await fx.insertCustomer(app, otherBiz, other);
    await withTenant(app, { businessId: otherBiz, userId: other }, (cl) =>
      cl.query(
        "INSERT INTO ledger_entries (business_id, customer_id, type, amount, created_by, source, idempotency_key) VALUES ($1, $2, 'DEBT', 1, $3, 'BOT', 'same-key')",
        [otherBiz, oc, other],
      ),
    );
  });

  it('seq ketma-ket o‘sadi', async () => {
    const c = await fx.insertCustomer(app, biz, owner);
    await inBiz(async (cl) => {
      await insertEntry(cl, c, 'DEBT', 1);
      await insertEntry(cl, c, 'DEBT', 2);
      await insertEntry(cl, c, 'DEBT', 3);
    });
    const { rows } = await inBiz((cl) =>
      cl.query('SELECT amount, seq FROM ledger_entries WHERE customer_id = $1 ORDER BY seq', [c]),
    );
    expect(rows.map((r) => r.amount)).toEqual(['1', '2', '3']);
    const seqs = rows.map((r) => Number(r.seq));
    expect(seqs[1]).toBeGreaterThan(seqs[0]!);
    expect(seqs[2]).toBeGreaterThan(seqs[1]!);
  });
});

describe('tenant isolation (AC-06) DB darajasida', () => {
  it('A konteksti B mijoziga yozib bo‘lmaydi: FK (business_id, customer_id) va RLS', async () => {
    const bCustomer = await fx.insertCustomer(app, otherBiz, other, 'B mijozi');
    // A biznes ID si bilan B mijozi: juftlik mavjud emas → FK
    expect(await pgCode(inBiz((cl) => insertEntry(cl, bCustomer, 'DEBT', 1000)))).toBe(FK);
    // B biznes ID si bilan, lekin A konteksti: RLS WITH CHECK
    expect(
      await pgCode(
        inBiz((cl) => insertEntry(cl, bCustomer, 'DEBT', 1000, { businessId: otherBiz })),
      ),
    ).toBe(DENIED);
    expect(await balanceOf(bCustomer, otherBiz, other)).toBe(0);
  });

  it('A konteksti B mijozlari, ledger va balanslarini ko‘rmaydi', async () => {
    const bCustomer = await fx.insertCustomer(app, otherBiz, other, 'Yashirin');
    await withTenant(app, { businessId: otherBiz, userId: other }, (cl) =>
      insertEntry(cl, bCustomer, 'DEBT', 5000, { businessId: otherBiz }),
    );
    const names = await inBiz((cl) => cl.query("SELECT 1 FROM customers WHERE name = 'Yashirin'"));
    expect(names.rowCount).toBe(0);
    const entries = await inBiz((cl) =>
      cl.query('SELECT 1 FROM ledger_entries WHERE customer_id = $1', [bCustomer]),
    );
    expect(entries.rowCount).toBe(0);
    const bal = await inBiz((cl) =>
      cl.query('SELECT 1 FROM customer_balances WHERE customer_id = $1', [bCustomer]),
    );
    expect(bal.rowCount).toBe(0);
    expect((await app.query('SELECT 1 FROM ledger_entries')).rowCount).toBe(0); // kontekstsiz — hech narsa
  });
});

describe('storno qoidalari (ADR-0002 §5)', () => {
  async function withDebt(amount = 450000) {
    const c = await fx.insertCustomer(app, biz, owner);
    const debt = await inBiz((cl) => insertEntry(cl, c, 'DEBT', amount));
    return { c, debt };
  }

  it('DEBT stornosi: teskari ADJUSTMENT balansni qaytaradi', async () => {
    const { c, debt } = await withDebt();
    await inBiz((cl) => insertEntry(cl, c, 'ADJUSTMENT', -450000, { reverses: debt.id }));
    expect(await balanceOf(c)).toBe(0);
  });

  it('PAYMENT stornosi musbat ADJUSTMENT', async () => {
    const { c } = await withDebt(100000);
    const pay = await inBiz((cl) => insertEntry(cl, c, 'PAYMENT', 40000));
    await inBiz((cl) => insertEntry(cl, c, 'ADJUSTMENT', 40000, { reverses: pay.id }));
    expect(await balanceOf(c)).toBe(100000);
  });

  it('bitta yozuv ikki marta storno qilinmaydi', async () => {
    const { c, debt } = await withDebt();
    await inBiz((cl) => insertEntry(cl, c, 'ADJUSTMENT', -450000, { reverses: debt.id }));
    expect(
      await pgCode(inBiz((cl) => insertEntry(cl, c, 'ADJUSTMENT', -450000, { reverses: debt.id }))),
    ).toBe(UNIQUE);
  });

  it('stornoni qayta storno qilib bo‘lmaydi', async () => {
    const { c, debt } = await withDebt();
    const storno = await inBiz((cl) =>
      insertEntry(cl, c, 'ADJUSTMENT', -450000, { reverses: debt.id }),
    );
    expect(
      await pgCode(
        inBiz((cl) => insertEntry(cl, c, 'ADJUSTMENT', 450000, { reverses: storno.id })),
      ),
    ).toBe(INTEGRITY);
  });

  it('summa original teskarisiga teng bo‘lishi shart', async () => {
    const { c, debt } = await withDebt();
    expect(
      await pgCode(inBiz((cl) => insertEntry(cl, c, 'ADJUSTMENT', -1, { reverses: debt.id }))),
    ).toBe(INTEGRITY);
    expect(
      await pgCode(inBiz((cl) => insertEntry(cl, c, 'ADJUSTMENT', 450000, { reverses: debt.id }))),
    ).toBe(INTEGRITY);
  });

  it('storno faqat ADJUSTMENT turida (trigger yoki CHECK rad etadi)', async () => {
    const { c, debt } = await withDebt(1000);
    const code = await pgCode(
      inBiz((cl) => insertEntry(cl, c, 'PAYMENT', 1000, { reverses: debt.id })),
    );
    expect([CHECK, INTEGRITY]).toContain(code);
    expect(await balanceOf(c)).toBe(1000);
  });

  it('boshqa mijoz yozuvini storno qilib bo‘lmaydi', async () => {
    const { debt } = await withDebt(1000);
    const c2 = await fx.insertCustomer(app, biz, owner, 'Boshqa');
    await inBiz((cl) => insertEntry(cl, c2, 'DEBT', 1000));
    expect(
      await pgCode(inBiz((cl) => insertEntry(cl, c2, 'ADJUSTMENT', -1000, { reverses: debt.id }))),
    ).toBe(FK);
  });

  it('keyingi to‘lovi bor DEBT stornosi balansni manfiy qilsa rad etiladi', async () => {
    const { c, debt } = await withDebt(100000);
    await inBiz((cl) => insertEntry(cl, c, 'PAYMENT', 70000));
    expect(
      await pgCode(inBiz((cl) => insertEntry(cl, c, 'ADJUSTMENT', -100000, { reverses: debt.id }))),
    ).toBe(CHECK);
    expect(await balanceOf(c)).toBe(30000);
  });
});

describe('mijoz identifikatsiyasi', () => {
  it('bir xil (ism, yorliq) faol mijozlar orasida takrorlanmaydi; yorliq farqlaydi', async () => {
    const name = `Ali-${randomUUID().slice(0, 8)}`;
    await fx.insertCustomer(app, biz, owner, name);
    expect(await pgCode(fx.insertCustomer(app, biz, owner, name))).toBe(UNIQUE);
    await fx.insertCustomer(app, biz, owner, name, 'aka');
    expect(await pgCode(fx.insertCustomer(app, biz, owner, name, 'aka'))).toBe(UNIQUE);
    await fx.insertCustomer(app, biz, owner, name, 'qo‘shni');
  });

  it('arxivlangan mijoz noyoblikka xalaqit bermaydi', async () => {
    const name = `Arx-${randomUUID().slice(0, 8)}`;
    const first = await fx.insertCustomer(app, biz, owner, name);
    await inBiz((cl) =>
      cl.query("UPDATE customers SET status = 'ARCHIVED' WHERE id = $1", [first]),
    );
    await fx.insertCustomer(app, biz, owner, name);
  });

  it('boshqa biznesda bir xil nom mumkin; noto‘g‘ri telefon va bo‘sh nom rad etiladi', async () => {
    const name = `Umumiy-${randomUUID().slice(0, 8)}`;
    await fx.insertCustomer(app, biz, owner, name);
    await fx.insertCustomer(app, otherBiz, other, name);
    const bad = (phone: string | null, nm = 'X') =>
      inBiz((cl) =>
        cl.query(
          'INSERT INTO customers (business_id, name, normalized_name, phone, created_by) VALUES ($1, $2, lower($2), $3, $4)',
          [biz, nm, phone, owner],
        ),
      );
    expect(await pgCode(bad('901234567'))).toBe(CHECK);
    expect(await pgCode(bad('+99890123'))).toBe(CHECK);
    expect(await pgCode(bad(null, '   '))).toBe(CHECK);
  });
});
