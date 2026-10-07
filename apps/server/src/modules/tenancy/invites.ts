import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { withTenant } from '../../db/tenant.js';
import { ConflictError } from '../../errors/index.js';
import { getContext } from '../../observability/context.js';
import { requirePermission, type BusinessAccess } from './access.js';
import type { Role } from './permissions.js';

export const INVITE_TTL_HOURS = 48;
export const MAX_ACTIVE_INVITES = 20;
/** Telegram `start` parametri: A-Za-z0-9_- , ko'pi bilan 64 belgi ("inv_" + token). */
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{20,60}$/;

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export interface CreatedInvite {
  /** Faqat shu yerda ochiq ko'rinishda; DB'da faqat hash saqlanadi. */
  readonly token: string;
  readonly expiresAt: Date;
}

export async function createInvite(pool: Pool, access: BusinessAccess): Promise<CreatedInvite> {
  requirePermission(access, 'staff.manage');
  const token = randomBytes(24).toString('base64url'); // 192 bit
  return withTenant(pool, { businessId: access.businessId, userId: access.userId }, async (c) => {
    const active = await c.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM invites WHERE business_id = $1 AND used_at IS NULL AND expires_at > now()',
      [access.businessId],
    );
    if ((active.rows[0]?.n ?? 0) >= MAX_ACTIVE_INVITES) {
      throw new ConflictError('Faol takliflar soni limitga yetdi', {
        details: { max: MAX_ACTIVE_INVITES },
      });
    }
    const { rows } = await c.query<{ expires_at: Date; id: string }>(
      `INSERT INTO invites (business_id, token_hash, expires_at, created_by)
       VALUES ($1, $2, now() + make_interval(hours => $3), $4) RETURNING id, expires_at`,
      [access.businessId, hashToken(token), INVITE_TTL_HOURS, access.userId],
    );
    await c.query(
      `INSERT INTO audit_logs (business_id, actor_user_id, action, entity, entity_id, request_id)
       VALUES ($1, $2, 'invite.create', 'invite', $3, $4)`,
      [access.businessId, access.userId, rows[0]!.id, getContext()?.requestId ?? null],
    );
    return { token, expiresAt: rows[0]!.expires_at };
  });
}

export interface RedeemedInvite {
  readonly businessId: string;
  readonly businessName: string;
  readonly role: Role;
  /** Haqiqatan yangi qo'shildi (yoki qayta faollashdi)? Allaqachon a'zo bo'lsa false. */
  readonly joined: boolean;
  readonly ownerTelegramId: number;
}

/** Yaroqsiz (format, topilmagan, muddati o'tgan, ishlatilgan) token uchun `undefined`. */
export async function redeemInvite(
  pool: Pool,
  userId: string,
  token: string,
): Promise<RedeemedInvite | undefined> {
  if (!TOKEN_FORMAT.test(token)) return undefined;
  const { rows } = await pool.query<{
    out_business_id: string;
    out_role: Role;
    out_joined: boolean;
  }>('SELECT * FROM redeem_invite($1, $2)', [hashToken(token), userId]);
  const row = rows[0];
  if (!row) return undefined;

  return withTenant(pool, { businessId: row.out_business_id, userId }, async (c) => {
    await c.query('UPDATE users SET active_business_id = $2 WHERE id = $1', [
      userId,
      row.out_business_id,
    ]);
    if (row.out_joined) {
      await c.query(
        `INSERT INTO audit_logs (business_id, actor_user_id, action, entity, entity_id, request_id)
         VALUES ($1, $2, 'member.join', 'user', $2::uuid::text, $3)`,
        [row.out_business_id, userId, getContext()?.requestId ?? null],
      );
    }
    const biz = await c.query<{ name: string; telegram_user_id: string }>(
      `SELECT b.name, u.telegram_user_id FROM businesses b JOIN users u ON u.id = b.owner_user_id WHERE b.id = $1`,
      [row.out_business_id],
    );
    return {
      businessId: row.out_business_id,
      businessName: biz.rows[0]!.name,
      role: row.out_role,
      joined: row.out_joined,
      ownerTelegramId: Number(biz.rows[0]!.telegram_user_id),
    };
  });
}
