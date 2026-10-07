import type { Pool, PoolClient } from 'pg';
import { BusinessRequiredError, ForbiddenError, ValidationError } from '../../errors/index.js';
import { withTenant } from '../../db/tenant.js';
import { setContext } from '../../observability/context.js';
import type { User } from '../identity/index.js';
import { can, type Permission, type Role } from './permissions.js';

/** Server tomonida tasdiqlangan kirish: foydalanuvchi + biznes + rol. Faqat shu orqali biznes ma'lumotiga murojaat qilinadi. */
export interface BusinessAccess {
  readonly userId: string;
  readonly businessId: string;
  readonly role: Role;
}

export interface Membership {
  readonly businessId: string;
  readonly name: string;
  readonly shortCode: string;
  readonly role: Role;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Foydalanuvchining ACTIVE a'zoliklari. RLS: faqat `app.user_id` bo'yicha o'z a'zoliklari ko'rinadi. */
export async function listMemberships(pool: Pool, userId: string): Promise<Membership[]> {
  const { rows } = await withTenant(pool, { userId }, (client) =>
    client.query<{ business_id: string; name: string; short_code: string; role: Role }>(
      `SELECT m.business_id, b.name, b.short_code, m.role
         FROM business_members m
         JOIN businesses b ON b.id = m.business_id
        WHERE m.user_id = $1 AND m.status = 'ACTIVE'
        ORDER BY b.name, m.business_id`,
      [userId],
    ),
  );
  return rows.map((r) => ({
    businessId: r.business_id,
    name: r.name,
    shortCode: r.short_code,
    role: r.role,
  }));
}

/**
 * Aktiv biznesni aniqlaydi va a'zolikni HAR SAFAR DB'dan tekshiradi (keshsiz): revoke darhol ta'sir qiladi.
 * Tanlash tartibi: so'rovdagi selector → users.active_business_id → yagona a'zolik.
 * Selector faqat "qaysi biznes" signali: a'zo bo'lmagan yoki mavjud bo'lmagan biznes uchun bir xil ForbiddenError
 * (mavjudlik oshkor qilinmaydi).
 */
export async function resolveBusinessAccess(
  pool: Pool,
  user: Pick<User, 'id' | 'activeBusinessId'>,
  selector?: string | null,
): Promise<BusinessAccess> {
  const memberships = await listMemberships(pool, user.id);

  if (selector !== undefined && selector !== null && selector !== '') {
    if (!UUID.test(selector)) throw new ValidationError('business_id noto‘g‘ri');
    const chosen = memberships.find((m) => m.businessId === selector.toLowerCase());
    if (!chosen) throw new ForbiddenError();
    return { userId: user.id, businessId: chosen.businessId, role: chosen.role };
  }

  const preferred = memberships.find((m) => m.businessId === user.activeBusinessId);
  const chosen = preferred ?? (memberships.length === 1 ? memberships[0] : undefined);
  if (!chosen) {
    throw new BusinessRequiredError({
      details: { reason: memberships.length === 0 ? 'NO_MEMBERSHIP' : 'CHOOSE_BUSINESS' },
    });
  }
  return { userId: user.id, businessId: chosen.businessId, role: chosen.role };
}

/** Aktiv biznesni almashtiradi. Faqat ACTIVE a'zo bo'lgan biznesga. */
export async function setActiveBusiness(
  pool: Pool,
  userId: string,
  businessId: string,
): Promise<BusinessAccess> {
  const access = await resolveBusinessAccess(
    pool,
    { id: userId, activeBusinessId: null },
    businessId,
  );
  await pool.query('UPDATE users SET active_business_id = $2 WHERE id = $1', [
    userId,
    access.businessId,
  ]);
  return access;
}

export function requirePermission(access: BusinessAccess, permission: Permission): void {
  if (!can(access.role, permission)) throw new ForbiddenError();
}

/**
 * Biznes ma'lumotiga murojaat qilishning yagona yo'li: RLS konteksti o'rnatilgan tranzaksiya.
 * (Ixtiyoriy `permission` bo'lsa avval tekshiriladi.)
 */
export async function withBusiness<T>(
  pool: Pool,
  access: BusinessAccess,
  fn: (client: PoolClient) => Promise<T>,
  permission?: Permission,
): Promise<T> {
  if (permission) requirePermission(access, permission);
  setContext({ businessId: access.businessId });
  return withTenant(pool, { businessId: access.businessId, userId: access.userId }, fn);
}
