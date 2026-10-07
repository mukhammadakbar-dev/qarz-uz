import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_APP_URL } from '../../../test/env.js';
import * as fx from '../../../test/fixtures.js';
import { createPool } from '../../db/pool.js';
import { BusinessRequiredError, ForbiddenError, ValidationError } from '../../errors/index.js';
import { findUserById } from '../identity/index.js';
import {
  listMemberships,
  requirePermission,
  resolveBusinessAccess,
  setActiveBusiness,
  withBusiness,
} from './index.js';

let pool: Pool;
beforeAll(() => {
  pool = createPool(TEST_APP_URL, { max: 4 });
});
afterAll(async () => {
  await pool.end();
});

const user = (id: string, activeBusinessId: string | null = null) => ({ id, activeBusinessId });

describe('resolveBusinessAccess', () => {
  it('a’zoligi yo‘q foydalanuvchi: BUSINESS_REQUIRED (NO_MEMBERSHIP)', async () => {
    const u = await fx.createUser(pool);
    const err = await resolveBusinessAccess(pool, user(u)).catch((e) => e);
    expect(err).toBeInstanceOf(BusinessRequiredError);
    expect(err.details).toEqual({ reason: 'NO_MEMBERSHIP' });
  });

  it('yagona a’zolik avtomatik tanlanadi, rol DB’dan olinadi', async () => {
    const owner = await fx.createUser(pool);
    const biz = await fx.createBusiness(pool, owner);
    expect(await resolveBusinessAccess(pool, user(owner))).toEqual({
      userId: owner,
      businessId: biz,
      role: 'OWNER',
    });
  });

  it('bir nechta a’zolik: tanlanmagan bo‘lsa CHOOSE_BUSINESS, active_business_id yoki selector bilan tanlanadi', async () => {
    const u = await fx.createUser(pool);
    const b1 = await fx.createBusiness(pool, u, 'B1');
    const b2 = await fx.createBusiness(pool, u, 'B2');
    const err = await resolveBusinessAccess(pool, user(u)).catch((e) => e);
    expect(err).toBeInstanceOf(BusinessRequiredError);
    expect(err.details).toEqual({ reason: 'CHOOSE_BUSINESS' });

    expect((await resolveBusinessAccess(pool, user(u, b2))).businessId).toBe(b2);
    expect((await resolveBusinessAccess(pool, user(u, b2), b1)).businessId).toBe(b1);
  });

  it('AC-06: boshqa biznes yoki mavjud bo‘lmagan biznes selektori bir xil ForbiddenError beradi', async () => {
    const a = await fx.createUser(pool);
    const b = await fx.createUser(pool);
    await fx.createBusiness(pool, a);
    const bizB = await fx.createBusiness(pool, b);
    const other = await resolveBusinessAccess(pool, user(a), bizB).catch((e) => e);
    const missing = await resolveBusinessAccess(
      pool,
      user(a),
      '00000000-0000-4000-8000-000000000000',
    ).catch((e) => e);
    expect(other).toBeInstanceOf(ForbiddenError);
    expect(missing).toBeInstanceOf(ForbiddenError);
    expect(other.message).toBe(missing.message);
    expect(other.details).toEqual(missing.details);
  });

  it('noto‘g‘ri formatdagi selector: ValidationError', async () => {
    const u = await fx.createUser(pool);
    await fx.createBusiness(pool, u);
    await expect(resolveBusinessAccess(pool, user(u), "x' OR 1=1")).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('revoke darhol kuchga kiradi (keshsiz)', async () => {
    const owner = await fx.createUser(pool);
    const staff = await fx.createUser(pool);
    const biz = await fx.createBusiness(pool, owner);
    await fx.addMember(pool, biz, owner, staff);
    expect((await resolveBusinessAccess(pool, user(staff), biz)).role).toBe('STAFF');

    await fx.revokeMember(pool, biz, owner, staff);
    await expect(resolveBusinessAccess(pool, user(staff), biz)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(resolveBusinessAccess(pool, user(staff))).rejects.toBeInstanceOf(
      BusinessRequiredError,
    );
  });

  it('active_business_id eskirgan (a’zolik yo‘q) bo‘lsa e’tiborsiz, yagona a’zolikka tushadi', async () => {
    const owner = await fx.createUser(pool);
    const staff = await fx.createUser(pool);
    const gone = await fx.createBusiness(pool, owner, 'Gone');
    await fx.addMember(pool, gone, owner, staff);
    const own = await fx.createBusiness(pool, staff, 'Own');
    await fx.revokeMember(pool, gone, owner, staff);
    expect((await resolveBusinessAccess(pool, user(staff, gone))).businessId).toBe(own);
  });

  it('rol o‘zgarishi (STAFF → OWNER) keyingi so‘rovda ko‘rinadi', async () => {
    const owner = await fx.createUser(pool);
    const other = await fx.createUser(pool);
    const biz = await fx.createBusiness(pool, owner);
    await fx.addMember(pool, biz, owner, other);
    expect((await resolveBusinessAccess(pool, user(other))).role).toBe('STAFF');
  });
});

describe('listMemberships', () => {
  it('faqat ACTIVE a’zoliklar, faqat o‘ziniki', async () => {
    const a = await fx.createUser(pool);
    const b = await fx.createUser(pool);
    const bizA = await fx.createBusiness(pool, a, 'A');
    await fx.createBusiness(pool, b, 'B');
    expect(await listMemberships(pool, a)).toEqual([
      expect.objectContaining({ businessId: bizA, name: 'A', role: 'OWNER' }),
    ]);
  });
});

describe('setActiveBusiness', () => {
  it('a’zo bo‘lgan biznesni saqlaydi, a’zo bo‘lmaganini rad etadi', async () => {
    const a = await fx.createUser(pool);
    const b = await fx.createUser(pool);
    const b1 = await fx.createBusiness(pool, a, 'B1');
    await fx.createBusiness(pool, a, 'B2');
    const foreign = await fx.createBusiness(pool, b, 'Foreign');

    await setActiveBusiness(pool, a, b1);
    expect((await findUserById(pool, a))?.activeBusinessId).toBe(b1);

    await expect(setActiveBusiness(pool, a, foreign)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await findUserById(pool, a))?.activeBusinessId).toBe(b1);
  });
});

describe('withBusiness va requirePermission', () => {
  it('STAFF ruxsatsiz amalda ForbiddenError, RLS konteksti faqat o‘z biznesini ochadi', async () => {
    const owner = await fx.createUser(pool);
    const staff = await fx.createUser(pool);
    const other = await fx.createUser(pool);
    const biz = await fx.createBusiness(pool, owner, 'Mening');
    await fx.createBusiness(pool, other, 'Begona');
    await fx.addMember(pool, biz, owner, staff);
    const access = await resolveBusinessAccess(pool, user(staff), biz);

    expect(() => requirePermission(access, 'staff.manage')).toThrow(ForbiddenError);
    expect(() => requirePermission(access, 'ledger.payment')).not.toThrow();
    await expect(
      withBusiness(pool, access, async () => 1, 'ledger.adjustment'),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const names = await withBusiness(
      pool,
      access,
      async (c) => (await c.query('SELECT name FROM businesses')).rows,
    );
    expect(names).toEqual([{ name: 'Mening' }]);
  });
});
