import type { Pool } from 'pg';
import { z } from 'zod';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/index.js';
import { getContext } from '../../observability/context.js';
import { normalizeBusinessName } from './onboarding.js';
import { withBusiness, withVerifiedBusiness, type BusinessAccess } from './access.js';
import type { Role } from './permissions.js';

/** Xodimlar va biznes sozlamalari (Mini App, TT §34). */

export interface StaffMember {
  readonly userId: string;
  readonly name: string;
  readonly username: string | null;
  readonly role: Role;
  readonly status: 'ACTIVE' | 'REVOKED';
  readonly joinedAt: Date;
  readonly revokedAt: Date | null;
}

export async function listStaff(pool: Pool, access: BusinessAccess): Promise<StaffMember[]> {
  const { rows } = await withBusiness(
    pool,
    access,
    (c) =>
      c.query<{
        user_id: string;
        first_name: string | null;
        last_name: string | null;
        username: string | null;
        role: Role;
        status: 'ACTIVE' | 'REVOKED';
        created_at: Date;
        revoked_at: Date | null;
      }>(
        `SELECT m.user_id, u.first_name, u.last_name, u.username, m.role, m.status, m.created_at, m.revoked_at
           FROM business_members m JOIN users u ON u.id = m.user_id
          WHERE m.business_id = $1
          ORDER BY (m.role = 'OWNER') DESC, (m.status = 'ACTIVE') DESC, m.created_at`,
        [access.businessId],
      ),
    'staff.manage',
  );
  return rows.map((r) => ({
    userId: r.user_id,
    name: [r.first_name, r.last_name].filter(Boolean).join(' ') || r.username || '—',
    username: r.username,
    role: r.role,
    status: r.status,
    joinedAt: r.created_at,
    revokedAt: r.revoked_at,
  }));
}

/**
 * Xodimni o'chirish (REVOKE). Faqat OWNER; OWNER'ni o'chirib bo'lmaydi (biznesda kamida bitta faol egasi qoladi).
 * Uning tugallanmagan qoralamalari bekor qilinadi va aktiv biznesi tozalanadi. Keyingi so'rovdayoq kirish yopiladi.
 */
export async function revokeMember(
  pool: Pool,
  access: BusinessAccess,
  userId: string,
): Promise<StaffMember> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new NotFoundError('Xodim topilmadi');
  await withVerifiedBusiness(pool, access, 'staff.manage', async (c, fresh) => {
    const { rows } = await c.query<{ role: Role; status: string }>(
      'SELECT role, status FROM business_members WHERE business_id = $1 AND user_id = $2 FOR UPDATE',
      [fresh.businessId, userId],
    );
    const target = rows[0];
    if (!target) throw new NotFoundError('Xodim topilmadi');
    if (target.role === 'OWNER') {
      throw new ConflictError('Biznes egasini o‘chirib bo‘lmaydi', {
        details: { reason: 'CANNOT_REVOKE_OWNER' },
      });
    }
    if (target.status === 'REVOKED') return; // idempotent
    await c.query(
      "UPDATE business_members SET status = 'REVOKED', revoked_at = now() WHERE business_id = $1 AND user_id = $2",
      [fresh.businessId, userId],
    );
    await c.query(
      "UPDATE pending_operations SET status = 'CANCELLED' WHERE business_id = $1 AND user_id = $2 AND status = 'PENDING'",
      [fresh.businessId, userId],
    );
    await c.query(
      'UPDATE users SET active_business_id = NULL WHERE id = $1 AND active_business_id = $2',
      [userId, fresh.businessId],
    );
    await c.query(
      `INSERT INTO audit_logs (business_id, actor_user_id, action, entity, entity_id, request_id)
       VALUES ($1, $2, 'member.revoke', 'user', $3::uuid::text, $4)`,
      [fresh.businessId, fresh.userId, userId, getContext()?.requestId ?? null],
    );
  });
  const member = (await listStaff(pool, access)).find((m) => m.userId === userId);
  if (!member) throw new NotFoundError('Xodim topilmadi');
  return member;
}

// ───────── Biznes sozlamalari ─────────

export interface BusinessSettings {
  readonly id: string;
  readonly name: string;
  readonly shortCode: string;
  readonly currency: string;
  readonly timezone: string;
  readonly notifyOwnerOnDelete: boolean;
}

const settingsPatch = z
  .object({ name: z.string().optional(), notifyOwnerOnDelete: z.boolean().optional() })
  .strict();
export type BusinessSettingsPatch = z.infer<typeof settingsPatch>;

export async function getBusinessSettings(
  pool: Pool,
  access: BusinessAccess,
): Promise<BusinessSettings> {
  const { rows } = await withBusiness(
    pool,
    access,
    (c) =>
      c.query<{
        id: string;
        name: string;
        short_code: string;
        currency: string;
        timezone: string;
        notify_owner_on_delete: boolean;
      }>(
        'SELECT id, name, short_code, currency, timezone, notify_owner_on_delete FROM businesses WHERE id = $1',
        [access.businessId],
      ),
    'customer.view',
  );
  const r = rows[0];
  if (!r) throw new NotFoundError('Biznes topilmadi');
  return {
    id: r.id,
    name: r.name,
    shortCode: r.short_code,
    currency: r.currency,
    timezone: r.timezone,
    notifyOwnerOnDelete: r.notify_owner_on_delete,
  };
}

export async function updateBusinessSettings(
  pool: Pool,
  access: BusinessAccess,
  patch: unknown,
): Promise<BusinessSettings> {
  const parsed = settingsPatch.safeParse(patch);
  if (!parsed.success) throw new ValidationError('Sozlamalar yaroqsiz');
  const name = parsed.data.name !== undefined ? normalizeBusinessName(parsed.data.name) : undefined;
  await withVerifiedBusiness(pool, access, 'business.settings', async (c, fresh) => {
    const before = await c.query<{ name: string; notify_owner_on_delete: boolean }>(
      'SELECT name, notify_owner_on_delete FROM businesses WHERE id = $1 FOR UPDATE',
      [fresh.businessId],
    );
    await c.query(
      `UPDATE businesses SET name = COALESCE($2, name), notify_owner_on_delete = COALESCE($3, notify_owner_on_delete) WHERE id = $1`,
      [fresh.businessId, name ?? null, parsed.data.notifyOwnerOnDelete ?? null],
    );
    await c.query(
      `INSERT INTO audit_logs (business_id, actor_user_id, action, entity, entity_id, before, after, request_id)
       VALUES ($1, $2, 'business.update', 'business', $1::uuid::text, $3::jsonb, $4::jsonb, $5)`,
      [
        fresh.businessId,
        fresh.userId,
        JSON.stringify(before.rows[0] ?? null),
        JSON.stringify({
          name: name ?? before.rows[0]?.name,
          notifyOwnerOnDelete:
            parsed.data.notifyOwnerOnDelete ?? before.rows[0]?.notify_owner_on_delete,
        }),
        getContext()?.requestId ?? null,
      ],
    );
  });
  return getBusinessSettings(pool, access);
}
