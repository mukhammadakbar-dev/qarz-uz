import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_APP_URL, TEST_MIGRATOR_URL, TEST_SYSTEM_URL } from '../../test/env.js';
import { createPool } from './pool.js';
import { withTenant } from './tenant.js';

let app: Pool;
let system: Pool;
let migrator: Pool;

beforeAll(() => {
  app = createPool(TEST_APP_URL, { max: 4 });
  system = createPool(TEST_SYSTEM_URL, { max: 2 });
  migrator = createPool(TEST_MIGRATOR_URL, { max: 2 });
});
afterAll(async () => {
  await Promise.all([app.end(), system.end(), migrator.end()]);
});

const tokenHash = () => createHash('sha256').update(randomUUID()).digest('hex');
let codeSeq = 0;
const shortCode = () =>
  `TD-${'ABCDEFGHJKLMNPQRSTUVWXYZ'[codeSeq % 24]}${'ABCDEFGHJK'[Math.floor(codeSeq / 24) % 10]}${String(2 + (codeSeq++ % 8))}K`;

async function createUser(name = 'user'): Promise<string> {
  const { rows } = await app.query<{ id: string }>(
    'INSERT INTO users (telegram_user_id, first_name) VALUES ($1, $2) RETURNING id',
    [Math.floor(Math.random() * 1e12), name],
  );
  return rows[0]!.id;
}

/** Onboarding oqimi: yangi biznes + OWNER + obuna bitta tranzaksiyada. */
async function createBusiness(ownerId: string, name = 'Do‘kon') {
  const businessId = randomUUID();
  await withTenant(app, { businessId, userId: ownerId }, async (c) => {
    await c.query(
      'INSERT INTO businesses (id, name, short_code, owner_user_id) VALUES ($1, $2, $3, $4)',
      [businessId, name, shortCode(), ownerId],
    );
    await c.query(
      "INSERT INTO business_members (business_id, user_id, role) VALUES ($1, $2, 'OWNER')",
      [businessId, ownerId],
    );
    await c.query(
      "INSERT INTO subscriptions (business_id, trial_ends_at) VALUES ($1, now() + interval '14 days')",
      [businessId],
    );
  });
  return businessId;
}

async function pgCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

const RLS_VIOLATION = '42501'; // insufficient_privilege (RLS WITH CHECK ham, GRANT yo'qligi ham)
const UNIQUE = '23505';
const CHECK = '23514';
const INTEGRITY = '23000';

describe('tenant isolation (RLS) — AC-06', () => {
  let ownerA: string, ownerB: string, bizA: string, bizB: string;
  beforeAll(async () => {
    ownerA = await createUser('A');
    ownerB = await createUser('B');
    bizA = await createBusiness(ownerA, 'A do‘kon');
    bizB = await createBusiness(ownerB, 'B do‘kon');
  });

  it('A konteksti faqat o‘z biznes ma’lumotini ko‘radi', async () => {
    await withTenant(app, { businessId: bizA, userId: ownerA }, async (c) => {
      expect((await c.query('SELECT id FROM businesses')).rows).toEqual([{ id: bizA }]);
      expect((await c.query('SELECT business_id FROM business_members')).rows).toEqual([
        { business_id: bizA },
      ]);
      expect((await c.query('SELECT business_id FROM subscriptions')).rows).toEqual([
        { business_id: bizA },
      ]);
    });
  });

  it('kontekst o‘rnatilmagan bo‘lsa hech narsa ko‘rinmaydi (fail-closed)', async () => {
    for (const table of [
      'businesses',
      'business_members',
      'invites',
      'subscriptions',
      'subscription_payments',
      'audit_logs',
    ]) {
      const { rows } = await app.query(`SELECT 1 FROM ${table}`);
      expect(rows, table).toEqual([]);
    }
  });

  it('A konteksti B biznesga yoza olmaydi', async () => {
    const code = await pgCode(
      withTenant(app, { businessId: bizA, userId: ownerA }, (c) =>
        c.query(
          "INSERT INTO business_members (business_id, user_id, role) VALUES ($1, $2, 'STAFF')",
          [bizB, ownerA],
        ),
      ),
    );
    expect(code).toBe(RLS_VIOLATION);
  });

  it('A konteksti B biznesni o‘zgartira olmaydi (0 qator)', async () => {
    const res = await withTenant(app, { businessId: bizA, userId: ownerA }, (c) =>
      c.query("UPDATE businesses SET name = 'hack' WHERE id = $1", [bizB]),
    );
    expect(res.rowCount).toBe(0);
    const { rows } = await withTenant(app, { businessId: bizB, userId: ownerB }, (c) =>
      c.query('SELECT name FROM businesses'),
    );
    expect(rows).toEqual([{ name: 'B do‘kon' }]);
  });

  it('A konteksti B biznes a’zosini revoke qila olmaydi', async () => {
    const res = await withTenant(app, { businessId: bizA, userId: ownerA }, (c) =>
      c.query(
        "UPDATE business_members SET status = 'REVOKED', revoked_at = now() WHERE business_id = $1",
        [bizB],
      ),
    );
    expect(res.rowCount).toBe(0);
  });

  it('boshqa biznes uchun businesses qatorini yaratib bo‘lmaydi', async () => {
    const id = randomUUID();
    const code = await pgCode(
      withTenant(app, { businessId: bizA, userId: ownerA }, (c) =>
        c.query(
          'INSERT INTO businesses (id, name, short_code, owner_user_id) VALUES ($1, $2, $3, $4)',
          [id, 'x', shortCode(), ownerA],
        ),
      ),
    );
    expect(code).toBe(RLS_VIOLATION);
  });

  it('foydalanuvchi konteksti o‘zining barcha a’zoliklarini ko‘radi (biznes tanlash uchun)', async () => {
    const multi = await createUser('multi');
    const biz1 = await createBusiness(multi, 'M1');
    const biz2 = await createBusiness(multi, 'M2');
    const { rows } = await withTenant(app, { userId: multi }, (c) =>
      c.query('SELECT business_id FROM business_members ORDER BY business_id'),
    );
    expect(rows.map((r) => r.business_id).toSorted()).toEqual([biz1, biz2].toSorted());
    const biz = await withTenant(app, { userId: multi }, (c) =>
      c.query('SELECT id FROM businesses'),
    );
    expect(biz.rows.map((r) => r.id).toSorted()).toEqual([biz1, biz2].toSorted());
  });

  it('REVOKED a’zo uchun biznes ro‘yxatda ko‘rinmaydi', async () => {
    const staff = await createUser('staff');
    const biz = await createBusiness(ownerA, 'Revoke sinovi');
    await withTenant(app, { businessId: biz, userId: ownerA }, (c) =>
      c.query(
        "INSERT INTO business_members (business_id, user_id, role, status, revoked_at) VALUES ($1, $2, 'STAFF', 'REVOKED', now())",
        [biz, staff],
      ),
    );
    const { rows } = await withTenant(app, { userId: staff }, (c) =>
      c.query('SELECT id FROM businesses'),
    );
    expect(rows).toEqual([]);
  });

  it('withTenant tranzaksiyadan keyin kontekst pool’ga sizib o‘tmaydi', async () => {
    await withTenant(app, { businessId: bizA, userId: ownerA }, (c) => c.query('SELECT 1'));
    const { rows } = await app.query('SELECT app_business_id() AS b, app_user_id() AS u');
    expect(rows[0]).toEqual({ b: null, u: null });
  });

  it('withTenant noto‘g‘ri UUID ni rad etadi', () => {
    expect(() => withTenant(app, { businessId: "x'; DROP TABLE users;--" }, async () => 1)).toThrow(
      TypeError,
    );
  });
});

describe('cheklovlar (CHECK/UNIQUE)', () => {
  it('short_code formati va noyobligi', async () => {
    const owner = await createUser();
    const id = randomUUID();
    const bad = ['td-ABCD', 'TD-AB', 'TD-0ABC', 'TD-IABC', 'XX-ABCD'];
    for (const code of bad) {
      const c = await pgCode(
        withTenant(app, { businessId: id, userId: owner }, (cl) =>
          cl.query(
            'INSERT INTO businesses (id, name, short_code, owner_user_id) VALUES ($1, $2, $3, $4)',
            [id, 'n', code, owner],
          ),
        ),
      );
      expect(c, code).toBe(CHECK);
    }
    const first = await createBusiness(owner);
    const { rows } = await migrator.query<{ short_code: string }>(
      'SELECT short_code FROM businesses WHERE id = $1',
      [first],
    );
    const dup = await pgCode(
      withTenant(app, { businessId: id, userId: owner }, (cl) =>
        cl.query(
          'INSERT INTO businesses (id, name, short_code, owner_user_id) VALUES ($1, $2, $3, $4)',
          [id, 'n', rows[0]!.short_code, owner],
        ),
      ),
    );
    expect(dup).toBe(UNIQUE);
  });

  it('a’zo roli, holati va revoked_at izchilligi', async () => {
    const owner = await createUser();
    const other = await createUser();
    const biz = await createBusiness(owner);
    const insert = (role: string, status: string, revokedAt: string | null) =>
      withTenant(app, { businessId: biz, userId: owner }, (c) =>
        c.query(
          'INSERT INTO business_members (business_id, user_id, role, status, revoked_at) VALUES ($1, $2, $3, $4, $5)',
          [biz, other, role, status, revokedAt],
        ),
      );
    expect(await pgCode(insert('ADMIN', 'ACTIVE', null))).toBe(CHECK);
    expect(await pgCode(insert('STAFF', 'BLOCKED', null))).toBe(CHECK);
    expect(await pgCode(insert('STAFF', 'REVOKED', null))).toBe(CHECK);
    expect(await pgCode(insert('STAFF', 'ACTIVE', new Date().toISOString()))).toBe(CHECK);
    await insert('STAFF', 'ACTIVE', null);
    expect(await pgCode(insert('STAFF', 'ACTIVE', null))).toBe(UNIQUE);
  });

  it('users: locale va telegram_user_id noyobligi', async () => {
    const tg = Math.floor(Math.random() * 1e12);
    await app.query('INSERT INTO users (telegram_user_id) VALUES ($1)', [tg]);
    expect(await pgCode(app.query('INSERT INTO users (telegram_user_id) VALUES ($1)', [tg]))).toBe(
      UNIQUE,
    );
    expect(
      await pgCode(
        app.query("INSERT INTO users (telegram_user_id, locale) VALUES ($1, 'ru')", [tg + 1]),
      ),
    ).toBe(CHECK);
  });

  it('processed_updates: takroriy update_id rad etiladi (dedupe)', async () => {
    const id = Math.floor(Math.random() * 1e9);
    const first = await app.query(
      'INSERT INTO processed_updates (update_id) VALUES ($1) ON CONFLICT DO NOTHING',
      [id],
    );
    const second = await app.query(
      'INSERT INTO processed_updates (update_id) VALUES ($1) ON CONFLICT DO NOTHING',
      [id],
    );
    expect([first.rowCount, second.rowCount]).toEqual([1, 0]);
  });
});

describe('huquqlar va o‘zgarmaslik', () => {
  let owner: string, biz: string;
  beforeAll(async () => {
    owner = await createUser();
    biz = await createBusiness(owner);
  });

  it('app roli obunani o‘zgartira olmaydi, system roli o‘zgartira oladi', async () => {
    const asApp = await pgCode(
      withTenant(app, { businessId: biz, userId: owner }, (c) =>
        c.query(
          "UPDATE subscriptions SET paid_until = now() + interval '30 days' WHERE business_id = $1",
          [biz],
        ),
      ),
    );
    expect(asApp).toBe(RLS_VIOLATION);
    const res = await system.query(
      "UPDATE subscriptions SET paid_until = now() + interval '30 days' WHERE business_id = $1",
      [biz],
    );
    expect(res.rowCount).toBe(1);
  });

  it('subscription_payments: app yoza olmaydi; system yozadi; hech kim o‘zgartira olmaydi', async () => {
    const row = [biz, 29000, 1, owner];
    const sql =
      "INSERT INTO subscription_payments (business_id, amount, months, period_from, period_to, recorded_by) VALUES ($1, $2, $3, now(), now() + interval '30 days', $4)";
    expect(
      await pgCode(withTenant(app, { businessId: biz, userId: owner }, (c) => c.query(sql, row))),
    ).toBe(RLS_VIOLATION);
    await system.query(sql, row);
    // system roliga UPDATE/DELETE grant berilmagan; egasiga (migrator) esa trigger to'sqinlik qiladi
    expect(await pgCode(system.query('UPDATE subscription_payments SET amount = 1'))).toBe(
      RLS_VIOLATION,
    );
    expect(await pgCode(migrator.query('UPDATE subscription_payments SET amount = 1'))).toBe(
      INTEGRITY,
    );
    expect(await pgCode(migrator.query('DELETE FROM subscription_payments'))).toBe(INTEGRITY);
    expect(await pgCode(system.query(sql, [biz, 0, 1, owner]))).toBe(CHECK);
    const seen = await withTenant(app, { businessId: biz, userId: owner }, (c) =>
      c.query('SELECT amount FROM subscription_payments'),
    );
    expect(seen.rows).toEqual([{ amount: '29000' }]);
  });

  it('audit_logs: o‘z biznesiga yoziladi, boshqasiga yoki global yozib bo‘lmaydi', async () => {
    const insert = (businessId: string | null, ctx: string) =>
      withTenant(app, { businessId: ctx, userId: owner }, (c) =>
        c.query(
          "INSERT INTO audit_logs (business_id, actor_user_id, action, entity) VALUES ($1, $2, 'test', 'x')",
          [businessId, owner],
        ),
      );
    await insert(biz, biz);
    expect(await pgCode(insert(null, biz))).toBe(RLS_VIOLATION);
    expect(await pgCode(insert(randomUUID(), biz))).toBe(RLS_VIOLATION);
  });

  it('audit_logs o‘zgarmas: UPDATE/DELETE/TRUNCATE egasiga ham taqiqlangan', async () => {
    expect(await pgCode(migrator.query("UPDATE audit_logs SET action = 'x'"))).toBe(INTEGRITY);
    expect(await pgCode(migrator.query('DELETE FROM audit_logs'))).toBe(INTEGRITY);
    expect(await pgCode(migrator.query('TRUNCATE audit_logs'))).toBe(INTEGRITY);
    expect(await pgCode(system.query('DELETE FROM audit_logs'))).toBeDefined();
  });

  it('processed_updates: app o‘chira olmaydi, system tozalay oladi', async () => {
    expect(await pgCode(app.query('DELETE FROM processed_updates'))).toBe(RLS_VIOLATION);
    const res = await system.query(
      "DELETE FROM processed_updates WHERE received_at < now() + interval '1 day'",
    );
    expect(res.rowCount).toBeGreaterThan(0);
  });

  it('system roli RLS ni chetlab o‘tadi (cross-tenant ish uchun)', async () => {
    const { rows } = await system.query('SELECT count(*)::int AS n FROM businesses');
    expect(rows[0].n).toBeGreaterThan(1);
  });
});

describe('redeem_invite (ADR-0006 §5)', () => {
  let owner: string, biz: string;
  beforeAll(async () => {
    owner = await createUser('owner');
    biz = await createBusiness(owner);
  });

  async function invite(opts: { expires?: string } = {}) {
    const hash = tokenHash();
    await withTenant(app, { businessId: biz, userId: owner }, (c) =>
      c.query(
        `INSERT INTO invites (business_id, token_hash, expires_at, created_by) VALUES ($1, $2, now() + $3::interval, $4)`,
        [biz, hash, opts.expires ?? '48 hours', owner],
      ),
    );
    return hash;
  }
  const redeem = async (hash: string, userId: string) =>
    (await app.query('SELECT * FROM redeem_invite($1, $2)', [hash, userId])).rows;

  it('yaroqli token: staff ulanadi, token bir martalik', async () => {
    const staff = await createUser('staff');
    const hash = await invite();
    expect(await redeem(hash, staff)).toEqual([{ out_business_id: biz, out_role: 'STAFF' }]);
    const m = await withTenant(app, { businessId: biz, userId: owner }, (c) =>
      c.query('SELECT role, status FROM business_members WHERE user_id = $1', [staff]),
    );
    expect(m.rows).toEqual([{ role: 'STAFF', status: 'ACTIVE' }]);
    const other = await createUser();
    expect(await redeem(hash, other)).toEqual([]);
  });

  it('muddati o‘tgan yoki noma’lum token hech narsa qaytarmaydi', async () => {
    const staff = await createUser();
    const expired = await invite({ expires: '-1 minute' });
    expect(await redeem(expired, staff)).toEqual([]);
    expect(await redeem(tokenHash(), staff)).toEqual([]);
    const m = await withTenant(app, { businessId: biz, userId: owner }, (c) =>
      c.query('SELECT 1 FROM business_members WHERE user_id = $1', [staff]),
    );
    expect(m.rowCount).toBe(0);
  });

  it('REVOKED staff qayta taklif bilan faollashadi', async () => {
    const staff = await createUser();
    await redeem(await invite(), staff);
    await withTenant(app, { businessId: biz, userId: owner }, (c) =>
      c.query(
        "UPDATE business_members SET status = 'REVOKED', revoked_at = now() WHERE user_id = $1",
        [staff],
      ),
    );
    expect(await redeem(await invite(), staff)).toEqual([
      { out_business_id: biz, out_role: 'STAFF' },
    ]);
    const m = await withTenant(app, { businessId: biz, userId: owner }, (c) =>
      c.query('SELECT status, revoked_at FROM business_members WHERE user_id = $1', [staff]),
    );
    expect(m.rows).toEqual([{ status: 'ACTIVE', revoked_at: null }]);
  });

  it('OWNER o‘z biznesining staff taklifini qabul qilsa roli pasaymaydi', async () => {
    expect(await redeem(await invite(), owner)).toEqual([
      { out_business_id: biz, out_role: 'OWNER' },
    ]);
  });

  it('parallel qabul qilishda token faqat bitta foydalanuvchiga tegadi', async () => {
    const hash = await invite();
    const users = await Promise.all(Array.from({ length: 6 }, () => createUser()));
    const results = await Promise.all(users.map((u) => redeem(hash, u)));
    expect(results.filter((r) => r.length === 1)).toHaveLength(1);
  });

  it('app roli invites jadvalini o‘zgartira olmaydi (token qayta ishlatilmasligi uchun)', async () => {
    expect(
      await pgCode(
        withTenant(app, { businessId: biz, userId: owner }, (c) =>
          c.query('UPDATE invites SET used_at = NULL, used_by = NULL'),
        ),
      ),
    ).toBe(RLS_VIOLATION);
  });
});
