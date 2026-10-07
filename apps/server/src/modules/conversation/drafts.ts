import type { DraftSpec } from '@nasiya/nlp';
import type { Pool } from 'pg';
import { withTenant } from '../../db/tenant.js';
import type { BusinessAccess } from '../tenancy/index.js';

/** Qoralama (ADR-0003): tasdiqlanmaguncha pul yozilmaydi. Faqat yaratgan foydalanuvchi tasdiqlay oladi. */

export const DRAFT_TTL_MINUTES = 15;

export type DraftStatus = 'PENDING' | 'COMMITTED' | 'CANCELLED' | 'EXPIRED' | 'SUPERSEDED';

export interface Draft {
  readonly id: string;
  readonly businessId: string;
  readonly userId: string;
  readonly spec: DraftSpec;
  readonly status: DraftStatus;
  readonly interpretationId: string | null;
  readonly resultEntryId: string | null;
  readonly expiresAt: Date;
  /** Muddati o'tdimi (DB vaqti bo'yicha hisoblangan). */
  readonly expired: boolean;
}

interface DraftRow {
  id: string;
  business_id: string;
  user_id: string;
  payload: DraftSpec;
  status: DraftStatus;
  interpretation_id: string | null;
  result_entry_id: string | null;
  expires_at: Date;
  expired: boolean;
}

const COLUMNS =
  'id, business_id, user_id, payload, status, interpretation_id, result_entry_id, expires_at, (expires_at <= now()) AS expired';

const toDraft = (r: DraftRow): Draft => ({
  id: r.id,
  businessId: r.business_id,
  userId: r.user_id,
  spec: r.payload,
  status: r.status,
  interpretationId: r.interpretation_id,
  resultEntryId: r.result_entry_id,
  expiresAt: r.expires_at,
  expired: r.expired,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ctx = (a: BusinessAccess) => ({ businessId: a.businessId, userId: a.userId });

export async function createDraft(
  pool: Pool,
  access: BusinessAccess,
  spec: DraftSpec,
  interpretationId: string | null = null,
): Promise<Draft> {
  const { rows } = await withTenant(pool, ctx(access), (c) =>
    c.query<DraftRow>(
      `INSERT INTO pending_operations (business_id, user_id, payload, interpretation_id, expires_at)
       VALUES ($1, $2, $3::jsonb, $4, now() + make_interval(mins => $5))
       RETURNING ${COLUMNS}`,
      [access.businessId, access.userId, JSON.stringify(spec), interpretationId, DRAFT_TTL_MINUTES],
    ),
  );
  return toDraft(rows[0]!);
}

/** Boshqa biznes yoki noto'g'ri ID → undefined (RLS). */
export async function loadDraft(
  pool: Pool,
  access: BusinessAccess,
  id: string,
): Promise<Draft | undefined> {
  if (!UUID.test(id)) return undefined;
  const { rows } = await withTenant(pool, ctx(access), (c) =>
    c.query<DraftRow>(`SELECT ${COLUMNS} FROM pending_operations WHERE id = $1`, [id]),
  );
  return rows[0] ? toDraft(rows[0]) : undefined;
}

/**
 * PENDING → yangi holat, atomik: faqat hozir ham PENDING bo'lsa o'tadi. `false` — boshqa jarayon allaqachon
 * o'tkazgan (ikki marta bosish, poyga).
 */
export async function transitionDraft(
  pool: Pool,
  access: BusinessAccess,
  id: string,
  to: Exclude<DraftStatus, 'PENDING'>,
  resultEntryId: string | null = null,
): Promise<boolean> {
  const { rowCount } = await withTenant(pool, ctx(access), (c) =>
    c.query(
      `UPDATE pending_operations SET status = $2, result_entry_id = COALESCE($3, result_entry_id)
        WHERE id = $1 AND status = 'PENDING'`,
      [id, to, resultEntryId],
    ),
  );
  return rowCount === 1;
}

/** Yangi mijoz yaratilgach uning ID sini qoralamaga yozadi (qayta urinishda ikkinchi mijoz yaratilmasligi uchun). */
export async function attachCustomer(
  pool: Pool,
  access: BusinessAccess,
  id: string,
  customerId: string,
): Promise<void> {
  await withTenant(pool, ctx(access), (c) =>
    c.query(
      `UPDATE pending_operations SET payload = jsonb_set(payload, '{customerId}', to_jsonb($2::text))
        WHERE id = $1 AND status = 'PENDING'`,
      [id, customerId],
    ),
  );
}
