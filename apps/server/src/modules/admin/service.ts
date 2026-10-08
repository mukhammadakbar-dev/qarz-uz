import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../../db/pool.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/index.js';
import { getContext } from '../../observability/context.js';
import { subscriptionStatus, type SubscriptionStatus } from '../billing/status.js';

/**
 * Superadmin paneli (ADR-0008). Do'konlararo o'qish `nasiya_system` (BYPASSRLS) pool orqali; har bir do'kon
 * ma'lumotini ko'rish audit'ga yoziladi. Do'kon ichidagi yozuvlar (qarz, to'lov) superadmin uchun YO'Q:
 * bu modulda faqat obuna, bloklash va audit yoziladi.
 */

export type SegmentState = 'TRIAL' | 'ACTIVE' | 'EXPIRED';
export type BusinessFilter = SegmentState | 'SUSPENDED';

/** status.ts bilan bir xil ustuvorlik: avval to'langan muddat, keyin sinov. Obunasi yo'q — EXPIRED. */
export const STATE_SQL = `CASE WHEN s.paid_until > now() THEN 'ACTIVE'
  WHEN s.trial_ends_at > now() THEN 'TRIAL' ELSE 'EXPIRED' END`;

const TODAY_SQL = `(date_trunc('day', now() AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'Asia/Tashkent')`;

export interface AdminStats {
  readonly businesses: number;
  readonly trial: number;
  readonly active: number;
  readonly expired: number;
  readonly suspended: number;
  /** 3 kun ichida tugaydigan (TRIAL yoki ACTIVE). */
  readonly expiringSoon: number;
  readonly newThisWeek: number;
  readonly users: number;
  readonly customers: number;
  readonly totalDebt: number;
  readonly entriesToday: number;
  /** Joriy oyda qayd etilgan obuna to'lovlari (so'm). */
  readonly revenueThisMonth: number;
}

export async function adminStats(sys: Pool): Promise<AdminStats> {
  const { rows } = await sys.query<Record<string, string | number>>(
    `WITH b AS (
       SELECT b.id, b.created_at, b.suspended_at, ${STATE_SQL} AS state,
              GREATEST(s.paid_until, s.trial_ends_at) AS ends_at
         FROM businesses b LEFT JOIN subscriptions s ON s.business_id = b.id
     )
     SELECT
       (SELECT count(*) FROM b)::int AS businesses,
       (SELECT count(*) FROM b WHERE state = 'TRIAL')::int AS trial,
       (SELECT count(*) FROM b WHERE state = 'ACTIVE')::int AS active,
       (SELECT count(*) FROM b WHERE state = 'EXPIRED')::int AS expired,
       (SELECT count(*) FROM b WHERE suspended_at IS NOT NULL)::int AS suspended,
       (SELECT count(*) FROM b WHERE state <> 'EXPIRED' AND ends_at < now() + interval '3 days')::int
         AS expiring_soon,
       (SELECT count(*) FROM b WHERE created_at > now() - interval '7 days')::int AS new_this_week,
       (SELECT count(*) FROM users)::int AS users,
       (SELECT count(*) FROM customers WHERE status = 'ACTIVE')::int AS customers,
       (SELECT COALESCE(sum(balance), 0) FROM customer_balances)::text AS total_debt,
       (SELECT count(*) FROM ledger_entries WHERE created_at >= ${TODAY_SQL})::int AS entries_today,
       (SELECT COALESCE(sum(amount), 0) FROM subscription_payments
         WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'Asia/Tashkent'
       )::text AS revenue_this_month`,
  );
  const r = rows[0]!;
  return {
    businesses: Number(r['businesses']),
    trial: Number(r['trial']),
    active: Number(r['active']),
    expired: Number(r['expired']),
    suspended: Number(r['suspended']),
    expiringSoon: Number(r['expiring_soon']),
    newThisWeek: Number(r['new_this_week']),
    users: Number(r['users']),
    customers: Number(r['customers']),
    totalDebt: Number(r['total_debt']),
    entriesToday: Number(r['entries_today']),
    revenueThisMonth: Number(r['revenue_this_month']),
  };
}

export interface AdminPerson {
  readonly userId: string;
  readonly telegramUserId: number;
  readonly username: string | null;
  readonly name: string;
}

export interface AdminBusinessRow {
  readonly id: string;
  readonly name: string;
  readonly shortCode: string;
  readonly createdAt: Date;
  readonly suspendedAt: Date | null;
  readonly suspendedReason: string | null;
  readonly owner: AdminPerson;
  readonly subscription: SubscriptionStatus;
  readonly customers: number;
  readonly totalDebt: number;
  readonly staff: number;
  readonly lastEntryAt: Date | null;
}

interface BusinessSqlRow {
  id: string;
  name: string;
  short_code: string;
  created_at: Date;
  suspended_at: Date | null;
  suspended_reason: string | null;
  owner_id: string;
  owner_tg: string;
  owner_username: string | null;
  owner_first: string | null;
  owner_last: string | null;
  trial_ends_at: Date | null;
  paid_until: Date | null;
  customers: number;
  total_debt: string;
  staff: number;
  last_entry_at: Date | null;
}

const personName = (first: string | null, last: string | null, fallback: string): string =>
  [first, last].filter(Boolean).join(' ').trim() || fallback;

const BUSINESS_SELECT = `
  SELECT b.id, b.name, b.short_code, b.created_at, b.suspended_at, b.suspended_reason,
         u.id AS owner_id, u.telegram_user_id::text AS owner_tg, u.username AS owner_username,
         u.first_name AS owner_first, u.last_name AS owner_last,
         s.trial_ends_at, s.paid_until,
         (SELECT count(*) FROM customers c WHERE c.business_id = b.id AND c.status = 'ACTIVE')::int
           AS customers,
         (SELECT COALESCE(sum(cb.balance), 0) FROM customer_balances cb WHERE cb.business_id = b.id)::text
           AS total_debt,
         (SELECT count(*) FROM business_members m
           WHERE m.business_id = b.id AND m.role = 'STAFF' AND m.status = 'ACTIVE')::int AS staff,
         (SELECT max(e.created_at) FROM ledger_entries e WHERE e.business_id = b.id) AS last_entry_at
    FROM businesses b
    JOIN users u ON u.id = b.owner_user_id
    LEFT JOIN subscriptions s ON s.business_id = b.id`;

function toBusinessRow(r: BusinessSqlRow, now = new Date()): AdminBusinessRow {
  return {
    id: r.id,
    name: r.name,
    shortCode: r.short_code,
    createdAt: r.created_at,
    suspendedAt: r.suspended_at,
    suspendedReason: r.suspended_reason,
    owner: {
      userId: r.owner_id,
      telegramUserId: Number(r.owner_tg),
      username: r.owner_username,
      name: personName(r.owner_first, r.owner_last, r.owner_username ?? r.owner_tg),
    },
    subscription: subscriptionStatus(
      { trialEndsAt: r.trial_ends_at ?? new Date(0), paidUntil: r.paid_until },
      now,
    ),
    customers: r.customers,
    totalDebt: Number(r.total_debt),
    staff: r.staff,
    lastEntryAt: r.last_entry_at,
  };
}

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (m) => `\\${m}`);

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify([createdAt.toISOString(), id])).toString('base64url');
}
function decodeCursor(raw: string): [string, string] {
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    if (
      Array.isArray(v) &&
      v.length === 2 &&
      typeof v[0] === 'string' &&
      !Number.isNaN(Date.parse(v[0])) &&
      typeof v[1] === 'string' &&
      /^[0-9a-f-]{36}$/i.test(v[1])
    )
      return [v[0], v[1]];
  } catch {
    /* pastga */
  }
  throw new ValidationError('cursor yaroqsiz', { details: { field: 'cursor' } });
}

export async function listBusinesses(
  sys: Pool,
  input: { q?: string; filter?: BusinessFilter; limit?: number; cursor?: string } = {},
): Promise<{ items: AdminBusinessRow[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 30), 1), 100);
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const q = input.q?.trim();
  if (q) {
    const like = add(`%${escapeLike(q)}%`);
    const conds = [
      `b.name ILIKE ${like}`,
      `b.short_code ILIKE ${like}`,
      `u.username ILIKE ${like}`,
      `u.first_name ILIKE ${like}`,
      `u.last_name ILIKE ${like}`,
    ];
    if (/^\d{3,15}$/.test(q)) conds.push(`u.telegram_user_id::text = ${add(q)}`);
    where.push(`(${conds.join(' OR ')})`);
  }
  if (input.filter === 'SUSPENDED') where.push('b.suspended_at IS NOT NULL');
  else if (input.filter) where.push(`${STATE_SQL} = ${add(input.filter)}`);
  if (input.cursor) {
    const [at, id] = decodeCursor(input.cursor);
    const a = add(at);
    const i = add(id);
    where.push(
      `(b.created_at < ${a}::timestamptz OR (b.created_at = ${a}::timestamptz AND b.id < ${i}::uuid))`,
    );
  }
  const { rows } = await sys.query<BusinessSqlRow>(
    `${BUSINESS_SELECT}
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY b.created_at DESC, b.id DESC
     LIMIT ${add(limit + 1)}`,
    params,
  );
  const page = rows.slice(0, limit).map((r) => toBusinessRow(r));
  const last = page.at(-1);
  return {
    items: page,
    nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

export interface AdminMember extends AdminPerson {
  readonly role: 'OWNER' | 'STAFF';
  readonly status: 'ACTIVE' | 'REVOKED';
  readonly joinedAt: Date;
}

export interface AdminPayment {
  readonly id: string;
  readonly amount: number;
  readonly months: number;
  readonly periodFrom: Date;
  readonly periodTo: Date;
  readonly note: string | null;
  readonly createdAt: Date;
  readonly recordedBy: string;
}

export interface AdminBusinessDetail extends AdminBusinessRow {
  readonly entries: number;
  readonly members: AdminMember[];
  readonly payments: AdminPayment[];
}

export async function getAdminBusiness(
  sys: Pool,
  businessId: string,
): Promise<AdminBusinessDetail> {
  if (!/^[0-9a-f-]{36}$/i.test(businessId)) throw new NotFoundError();
  const [biz, members, payments, entries] = await Promise.all([
    sys.query<BusinessSqlRow>(`${BUSINESS_SELECT} WHERE b.id = $1`, [businessId]),
    sys.query<{
      user_id: string;
      tg: string;
      username: string | null;
      first_name: string | null;
      last_name: string | null;
      role: 'OWNER' | 'STAFF';
      status: 'ACTIVE' | 'REVOKED';
      created_at: Date;
    }>(
      `SELECT m.user_id, u.telegram_user_id::text AS tg, u.username, u.first_name, u.last_name,
              m.role, m.status, m.created_at
         FROM business_members m JOIN users u ON u.id = m.user_id
        WHERE m.business_id = $1
        ORDER BY (m.role = 'OWNER') DESC, m.status, m.created_at`,
      [businessId],
    ),
    sys.query<{
      id: string;
      amount: string;
      months: number;
      period_from: Date;
      period_to: Date;
      note: string | null;
      created_at: Date;
      recorded_by: string;
    }>(
      `SELECT p.id, p.amount::text, p.months, p.period_from, p.period_to, p.note, p.created_at,
              COALESCE(NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), ''), u.username,
                       u.telegram_user_id::text) AS recorded_by
         FROM subscription_payments p JOIN users u ON u.id = p.recorded_by
        WHERE p.business_id = $1
        ORDER BY p.created_at DESC
        LIMIT 20`,
      [businessId],
    ),
    sys.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM ledger_entries WHERE business_id = $1',
      [businessId],
    ),
  ]);
  const row = biz.rows[0];
  if (!row) throw new NotFoundError('Do‘kon topilmadi');
  return {
    ...toBusinessRow(row),
    entries: entries.rows[0]?.n ?? 0,
    members: members.rows.map((m) => ({
      userId: m.user_id,
      telegramUserId: Number(m.tg),
      username: m.username,
      name: personName(m.first_name, m.last_name, m.username ?? m.tg),
      role: m.role,
      status: m.status,
      joinedAt: m.created_at,
    })),
    payments: payments.rows.map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      months: p.months,
      periodFrom: p.period_from,
      periodTo: p.period_to,
      note: p.note,
      createdAt: p.created_at,
      recordedBy: p.recorded_by,
    })),
  };
}

/** Audit: superadmin nima qildi yoki nimani ko'rdi. `businessId` bo'lmasa — platforma darajasidagi amal. */
export async function adminAudit(
  db: Pool | PoolClient,
  entry: {
    actorUserId: string;
    businessId: string | null;
    action: string;
    entity: string;
    entityId?: string | null;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (business_id, actor_user_id, action, entity, entity_id, before, after, request_id)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
    [
      entry.businessId,
      entry.actorUserId,
      entry.action,
      entry.entity,
      entry.entityId ?? null,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      getContext()?.requestId ?? null,
    ],
  );
}

export interface ExtendResult {
  readonly businessId: string;
  readonly name: string;
  readonly ownerTelegramId: number;
  readonly ownerLocale: 'uz-Latn' | 'uz-Cyrl';
  readonly periodFrom: Date;
  readonly paidUntil: Date;
}

/**
 * Obunani N oyga uzaytiradi (ADR-0005): new = max(now, paid_until, trial_ends_at) + N oy.
 * Takroriy chaqiruv yana uzaytiradi — shuning uchun API Idempotency-Key talab qiladi.
 */
export async function extendSubscription(
  sys: Pool,
  input: {
    businessId: string;
    months: number;
    amount: number;
    note?: string | null;
    actorUserId: string;
    /** Bot tasdig'i: tasdiq so'ralgan paytdagi tugash vaqti. O'zgargan bo'lsa (allaqachon uzaytirilgan) — rad. */
    expectedEndsAt?: Date;
  },
): Promise<ExtendResult> {
  if (!Number.isInteger(input.months) || input.months < 1 || input.months > 36)
    throw new ValidationError('Oy soni 1 dan 36 gacha', { details: { field: 'months' } });
  if (!Number.isInteger(input.amount) || input.amount < 1 || input.amount > 100_000_000)
    throw new ValidationError('Summa noto‘g‘ri', { details: { field: 'amount' } });
  const note = input.note?.trim() || null;
  if (note && note.length > 300)
    throw new ValidationError('Izoh juda uzun', { details: { field: 'note' } });

  return withTransaction(sys, async (c) => {
    const { rows } = await c.query<{
      trial_ends_at: Date;
      paid_until: Date | null;
      period_from: Date;
      ends_at: Date;
      name: string;
      owner_tg: string;
      owner_locale: 'uz-Latn' | 'uz-Cyrl';
    }>(
      `SELECT s.trial_ends_at, s.paid_until,
              GREATEST(now(), COALESCE(s.paid_until, now()), s.trial_ends_at) AS period_from,
              GREATEST(s.trial_ends_at, COALESCE(s.paid_until, s.trial_ends_at)) AS ends_at,
              b.name, u.telegram_user_id::text AS owner_tg, u.locale AS owner_locale
         FROM subscriptions s
         JOIN businesses b ON b.id = s.business_id
         JOIN users u ON u.id = b.owner_user_id
        WHERE s.business_id = $1
        FOR UPDATE OF s`,
      [input.businessId],
    );
    const before = rows[0];
    if (!before) throw new NotFoundError('Do‘kon topilmadi');
    if (input.expectedEndsAt && before.ends_at.getTime() !== input.expectedEndsAt.getTime())
      throw new ConflictError('Obuna allaqachon o‘zgargan', { details: { reason: 'STALE' } });
    const updated = await c.query<{ paid_until: Date }>(
      `UPDATE subscriptions SET paid_until = $2::timestamptz + make_interval(months => $3)
        WHERE business_id = $1 RETURNING paid_until`,
      [input.businessId, before.period_from, input.months],
    );
    const paidUntil = updated.rows[0]!.paid_until;
    await c.query(
      `INSERT INTO subscription_payments (business_id, amount, months, period_from, period_to, recorded_by, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.businessId,
        input.amount,
        input.months,
        before.period_from,
        paidUntil,
        input.actorUserId,
        note,
      ],
    );
    await adminAudit(c, {
      actorUserId: input.actorUserId,
      businessId: input.businessId,
      action: 'billing.extend',
      entity: 'subscription',
      entityId: input.businessId,
      before: { trialEndsAt: before.trial_ends_at, paidUntil: before.paid_until },
      after: { paidUntil, months: input.months, amount: input.amount },
    });
    return {
      businessId: input.businessId,
      name: before.name,
      ownerTelegramId: Number(before.owner_tg),
      ownerLocale: before.owner_locale,
      periodFrom: before.period_from,
      paidUntil,
    };
  });
}

/** Do'konni bloklash/blokdan chiqarish: bloklangan do'kon faqat o'qiladi (assertWritable). */
export async function setSuspended(
  sys: Pool,
  input: { businessId: string; suspended: boolean; reason?: string | null; actorUserId: string },
): Promise<{ suspendedAt: Date | null }> {
  const reason = input.suspended ? input.reason?.trim() || null : null;
  if (reason && reason.length > 500)
    throw new ValidationError('Sabab juda uzun', { details: { field: 'reason' } });
  return withTransaction(sys, async (c) => {
    const { rows } = await c.query<{ suspended_at: Date | null; before: Date | null }>(
      `UPDATE businesses b
          SET suspended_at = CASE WHEN $2 THEN COALESCE(old.suspended_at, now()) ELSE NULL END,
              suspended_reason = $3
         FROM (SELECT id, suspended_at FROM businesses WHERE id = $1 FOR UPDATE) old
        WHERE b.id = old.id
        RETURNING b.suspended_at, old.suspended_at AS before`,
      [input.businessId, input.suspended, reason],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError('Do‘kon topilmadi');
    await adminAudit(c, {
      actorUserId: input.actorUserId,
      businessId: input.businessId,
      action: input.suspended ? 'business.suspend' : 'business.unsuspend',
      entity: 'business',
      entityId: input.businessId,
      before: { suspendedAt: row.before },
      after: { suspendedAt: row.suspended_at, reason },
    });
    return { suspendedAt: row.suspended_at };
  });
}

/** Obunaning tugash vaqti (sinov yoki to'langan muddatning kechrog'i): tasdiq va eslatma kalitlari uchun. */
export const ENDS_SQL = 'GREATEST(s.trial_ends_at, COALESCE(s.paid_until, s.trial_ends_at))';

export async function subscriptionEndsAt(sys: Pool, businessId: string): Promise<Date> {
  const { rows } = await sys.query<{ ends_at: Date }>(
    `SELECT ${ENDS_SQL} AS ends_at FROM subscriptions s WHERE s.business_id = $1`,
    [businessId],
  );
  if (!rows[0]) throw new NotFoundError('Do‘kon topilmadi');
  return rows[0].ends_at;
}

/** Qisqa kod bo'yicha (TD-ABCD yoki ABCD, katta-kichik harf farqsiz). */
export async function findBusinessIdByCode(sys: Pool, code: string): Promise<string | null> {
  const normalized = code.trim().toUpperCase();
  const full = normalized.startsWith('TD-') ? normalized : `TD-${normalized}`;
  if (!/^TD-[A-Z0-9]{4,6}$/.test(full)) return null;
  const { rows } = await sys.query<{ id: string }>(
    'SELECT id FROM businesses WHERE short_code = $1',
    [full],
  );
  return rows[0]?.id ?? null;
}

export interface ExpiringBusiness {
  readonly id: string;
  readonly name: string;
  readonly shortCode: string;
  readonly owner: string;
  readonly endsAt: Date;
  readonly isTrial: boolean;
}

/** Yaqin `days` kun ichida tugaydigan (hali tugamagan, bloklanmagan) obunalar, eng yaqini birinchi. */
export async function listExpiring(
  sys: Pool,
  days: number,
  now = new Date(),
): Promise<ExpiringBusiness[]> {
  const { rows } = await sys.query<{
    id: string;
    name: string;
    short_code: string;
    owner: string;
    ends_at: Date;
    is_trial: boolean;
  }>(
    `SELECT b.id, b.name, b.short_code,
            COALESCE('@' || u.username, NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), ''),
                     u.telegram_user_id::text) AS owner,
            ${ENDS_SQL} AS ends_at,
            (s.paid_until IS NULL OR s.paid_until <= s.trial_ends_at) AS is_trial
       FROM businesses b
       JOIN subscriptions s ON s.business_id = b.id
       JOIN users u ON u.id = b.owner_user_id
      WHERE b.suspended_at IS NULL
        AND ${ENDS_SQL} > $1
        AND ${ENDS_SQL} <= $1 + make_interval(days => $2)
      ORDER BY ends_at
      LIMIT 50`,
    [now, days],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    shortCode: r.short_code,
    owner: r.owner,
    endsAt: r.ends_at,
    isTrial: r.is_trial,
  }));
}
