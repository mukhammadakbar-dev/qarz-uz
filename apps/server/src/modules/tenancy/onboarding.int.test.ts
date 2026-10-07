import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_APP_URL } from '../../../test/env.js';
import * as fx from '../../../test/fixtures.js';
import { withTenant } from '../../db/tenant.js';
import { createPool } from '../../db/pool.js';
import { ConflictError, ForbiddenError, ValidationError } from '../../errors/index.js';
import { clearState, getState, setState } from '../conversation/state.js';
import { findUserById } from '../identity/index.js';
import {
  createBusinessWithOwner,
  createInvite,
  listMemberships,
  normalizeBusinessName,
  redeemInvite,
  resolveBusinessAccess,
} from './index.js';

let pool: Pool;
beforeAll(() => {
  pool = createPool(TEST_APP_URL, { max: 8 });
});
afterAll(async () => {
  await pool.end();
});

const opts = { trialDays: 14 };

describe('normalizeBusinessName', () => {
  it('bo‘shliqlarni tozalaydi, boshqaruv belgilarini olib tashlaydi', () => {
    expect(normalizeBusinessName('  Baraka   do‘koni \n')).toBe('Baraka do‘koni');
    expect(normalizeBusinessName('A\u0000B​c')).toBe('A B c');
  });
  it('bo‘sh, juda uzun va buyruq ko‘rinishidagi nomni rad etadi', () => {
    for (const bad of ['', '   ', '/start', 'x'.repeat(101)]) {
      expect(() => normalizeBusinessName(bad), bad).toThrow(ValidationError);
    }
    expect(normalizeBusinessName('x'.repeat(100))).toHaveLength(100);
  });
});

describe('createBusinessWithOwner', () => {
  it('biznes, OWNER, obuna (14 kun sinov), aktiv biznes va audit bitta tranzaksiyada yaratiladi', async () => {
    const u = await fx.createUser(pool);
    const b = await createBusinessWithOwner(pool, u, '  Baraka  ', opts);
    expect(b).toMatchObject({ name: 'Baraka', trialGranted: true });
    expect(b.shortCode).toMatch(/^TD-[A-HJ-NP-Z2-9]{5}$/);
    const days = (b.trialEndsAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.99);
    expect(days).toBeLessThan(14.01);

    expect(await listMemberships(pool, u)).toEqual([
      expect.objectContaining({ businessId: b.businessId, role: 'OWNER', name: 'Baraka' }),
    ]);
    expect((await findUserById(pool, u))?.activeBusinessId).toBe(b.businessId);
    expect((await findUserById(pool, u))?.trialUsedAt).not.toBeNull();
    const audit = await withTenant(pool, { businessId: b.businessId, userId: u }, (c) =>
      c.query('SELECT action FROM audit_logs WHERE business_id = $1', [b.businessId]),
    );
    expect(audit.rows).toEqual([{ action: 'business.create' }]);
  });

  it('ikkinchi biznesga sinov berilmaydi: obuna darhol tugagan (ADR-0005)', async () => {
    const u = await fx.createUser(pool);
    await createBusinessWithOwner(pool, u, 'Birinchi', opts);
    const second = await createBusinessWithOwner(pool, u, 'Ikkinchi', opts);
    expect(second.trialGranted).toBe(false);
    expect(second.trialEndsAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('parallel ikkita so‘rov ikkita sinov ola olmaydi', async () => {
    const u = await fx.createUser(pool);
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => createBusinessWithOwner(pool, u, `Parallel ${i}`, opts)),
    );
    expect(results.filter((r) => r.trialGranted)).toHaveLength(1);
  });

  it('biznes limiti', async () => {
    const u = await fx.createUser(pool);
    for (let i = 0; i < 2; i++)
      await createBusinessWithOwner(pool, u, `B${i}`, { ...opts, maxOwned: 2 });
    await expect(
      createBusinessWithOwner(pool, u, 'B3', { ...opts, maxOwned: 2 }),
    ).rejects.toBeInstanceOf(ConflictError);
    // Rollback: ortiqcha biznes qolmagan
    expect((await listMemberships(pool, u)).length).toBe(2);
  });

  it('noto‘g‘ri nom hech narsa yaratmaydi (sinov ham sarflanmaydi)', async () => {
    const u = await fx.createUser(pool);
    await expect(createBusinessWithOwner(pool, u, '/start', opts)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect((await findUserById(pool, u))?.trialUsedAt).toBeNull();
  });
});

describe('invites', () => {
  async function setup() {
    const owner = await fx.createUser(pool, 'Owner');
    const staff = await fx.createUser(pool, 'Staff');
    const { businessId } = await createBusinessWithOwner(pool, owner, 'Do‘kon', opts);
    const ownerAccess = await resolveBusinessAccess(pool, {
      id: owner,
      activeBusinessId: businessId,
    });
    return { owner, staff, businessId, ownerAccess };
  }

  it('token DB’da faqat hash ko‘rinishida saqlanadi', async () => {
    const { ownerAccess, businessId, owner } = await setup();
    const { token } = await createInvite(pool, ownerAccess);
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const { rows } = await withTenant(pool, { businessId, userId: owner }, (c) =>
      c.query('SELECT token_hash FROM invites WHERE business_id = $1', [businessId]),
    );
    expect(rows).toEqual([{ token_hash: createHash('sha256').update(token).digest('hex') }]);
  });

  it('STAFF taklif yarata olmaydi', async () => {
    const { ownerAccess, staff, businessId } = await setup();
    const { token } = await createInvite(pool, ownerAccess);
    await redeemInvite(pool, staff, token);
    const staffAccess = await resolveBusinessAccess(pool, {
      id: staff,
      activeBusinessId: businessId,
    });
    expect(staffAccess.role).toBe('STAFF');
    await expect(createInvite(pool, staffAccess)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('qabul qilish: staff qo‘shiladi, aktiv biznes o‘rnatiladi, audit yoziladi, token bir martalik', async () => {
    const { ownerAccess, owner, staff, businessId } = await setup();
    const { token } = await createInvite(pool, ownerAccess);
    const res = await redeemInvite(pool, staff, token);
    expect(res).toMatchObject({ businessId, businessName: 'Do‘kon', role: 'STAFF', joined: true });
    expect((await findUserById(pool, staff))?.activeBusinessId).toBe(businessId);
    expect(res?.ownerTelegramId).toBe((await findUserById(pool, owner))?.telegramUserId);

    const audit = await withTenant(pool, { businessId, userId: owner }, (c) =>
      c.query(
        "SELECT action FROM audit_logs WHERE action LIKE 'member.%' OR action LIKE 'invite.%' ORDER BY created_at",
      ),
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['invite.create', 'member.join']);

    const other = await fx.createUser(pool);
    expect(await redeemInvite(pool, other, token)).toBeUndefined();
  });

  it('yaroqsiz formatdagi token DB’ga murojaat qilmasdan rad etiladi', async () => {
    const u = await fx.createUser(pool);
    for (const bad of [
      '',
      'abc',
      'x'.repeat(200),
      "a'; DROP TABLE invites;--aaaaaaaaaaaa",
      'a b c d e f g h i j k l m n',
    ]) {
      expect(await redeemInvite(pool, u, bad), bad).toBeUndefined();
    }
  });

  it('allaqachon a’zo bo‘lgan egasi taklifni ochsa joined=false va roli o‘zgarmaydi', async () => {
    const { ownerAccess, owner } = await setup();
    const { token } = await createInvite(pool, ownerAccess);
    const res = await redeemInvite(pool, owner, token);
    expect(res).toMatchObject({ role: 'OWNER', joined: false });
  });

  it('faol takliflar soni cheklangan', async () => {
    const { ownerAccess } = await setup();
    for (let i = 0; i < 20; i++) await createInvite(pool, ownerAccess);
    await expect(createInvite(pool, ownerAccess)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('conversation_state', () => {
  it('saqlaydi, o‘qiydi, almashtiradi va tozalaydi', async () => {
    const u = await fx.createUser(pool);
    expect(await getState(pool, u)).toBeUndefined();
    await setState(pool, u, 'A', { x: 1 });
    expect(await getState(pool, u)).toEqual({ state: 'A', data: { x: 1 } });
    await setState(pool, u, 'B');
    expect(await getState(pool, u)).toEqual({ state: 'B', data: {} });
    await clearState(pool, u);
    expect(await getState(pool, u)).toBeUndefined();
  });

  it('muddati o‘tgan holat ko‘rinmaydi', async () => {
    const u = await fx.createUser(pool);
    await setState(pool, u, 'A', {}, -1);
    expect(await getState(pool, u)).toBeUndefined();
  });

  it('boshqa foydalanuvchi holatini ko‘ra olmaydi (RLS)', async () => {
    const a = await fx.createUser(pool);
    const b = await fx.createUser(pool);
    await setState(pool, a, 'SECRET');
    const { rows } = await withTenant(pool, { userId: b }, (c) =>
      c.query('SELECT * FROM conversation_state'),
    );
    expect(rows).toEqual([]);
    expect((await pool.query('SELECT 1 FROM conversation_state')).rowCount).toBe(0);
  });
});
