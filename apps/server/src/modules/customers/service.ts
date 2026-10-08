import { normalizeName } from '@nasiya/shared';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/index.js';
import { getContext } from '../../observability/context.js';
import { assertWritable } from '../billing/guard.js';
import { withBusiness, withVerifiedBusiness, type BusinessAccess } from '../tenancy/index.js';
import { parseCustomerLabel, parseCustomerName, parseNotes, parsePhone } from './validation.js';

export type CustomerStatus = 'ACTIVE' | 'ARCHIVED';

export interface Customer {
  readonly id: string;
  readonly name: string;
  readonly label: string | null;
  readonly phone: string | null;
  readonly notes: string | null;
  readonly status: CustomerStatus;
  /** Joriy qarz (so'm), customer_balances proyeksiyasidan. */
  readonly balance: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Oxirgi yozuv (yoki yaratilish) vaqti: qarz qancha vaqtdan beri turganini ko'rsatish uchun. */
  readonly lastActivityAt: Date;
}

interface CustomerRow {
  id: string;
  name: string;
  label: string | null;
  phone: string | null;
  notes: string | null;
  status: CustomerStatus;
  balance: string;
  created_at: Date;
  updated_at: Date;
  last_activity_at: Date;
}

const SELECT = `
  SELECT c.id, c.name, c.label, c.phone, c.notes, c.status, b.balance, c.created_at, c.updated_at,
         b.updated_at AS last_activity_at
    FROM customers c
    JOIN customer_balances b ON b.customer_id = c.id AND b.business_id = c.business_id`;

const toCustomer = (r: CustomerRow): Customer => ({
  id: r.id,
  name: r.name,
  label: r.label,
  phone: r.phone,
  notes: r.notes,
  status: r.status,
  balance: Number(r.balance),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  lastActivityAt: r.last_activity_at,
});

const IDENTITY_INDEX = 'customers_identity_uq';
const isIdentityViolation = (e: unknown): boolean =>
  (e as { code?: string; constraint?: string }).code === '23505' &&
  (e as { constraint?: string }).constraint === IDENTITY_INDEX;

const audit = (
  c: PoolClient,
  access: BusinessAccess,
  action: string,
  customerId: string,
  before: unknown,
  after: unknown,
) =>
  c.query(
    `INSERT INTO audit_logs (business_id, actor_user_id, action, entity, entity_id, before, after, request_id)
     VALUES ($1, $2, $3, 'customer', $4::text, $5::jsonb, $6::jsonb, $7)`,
    [
      access.businessId,
      access.userId,
      action,
      customerId,
      before === null ? null : JSON.stringify(before),
      after === null ? null : JSON.stringify(after),
      getContext()?.requestId ?? null,
    ],
  );

/** Faol mijozlar orasida shu (ism, yorliq) bormi / shu ism bormi — tushunarli xato uchun. */
async function assertIdentityFree(
  c: PoolClient,
  businessId: string,
  normalizedName: string,
  normalizedLabel: string | null,
  excludeId: string | null,
): Promise<void> {
  const { rows } = await c.query<{ normalized_label: string | null }>(
    `SELECT normalized_label FROM customers
      WHERE business_id = $1 AND normalized_name = $2 AND status = 'ACTIVE'
        AND ($3::uuid IS NULL OR id <> $3)`,
    [businessId, normalizedName, excludeId],
  );
  if (rows.length === 0) return;
  if (normalizedLabel === null) {
    // Shu ismli mijoz allaqachon bor: farqlash uchun yorliq (masalan "qo'shni") kerak (TT §12)
    throw new ConflictError('Shu ismli mijoz bor, farqlash uchun yorliq kiriting', {
      details: { reason: 'LABEL_REQUIRED', existing: rows.length },
    });
  }
  if (rows.some((r) => r.normalized_label === normalizedLabel)) {
    throw new ConflictError('Bunday mijoz allaqachon bor', {
      details: { reason: 'DUPLICATE_IDENTITY' },
    });
  }
}

export interface CreateCustomerInput {
  readonly name: string;
  readonly label?: string | null;
  readonly phone?: string | null;
  readonly notes?: string | null;
}

export async function createCustomer(
  pool: Pool,
  access: BusinessAccess,
  input: CreateCustomerInput,
): Promise<Customer> {
  const name = parseCustomerName(input.name);
  const label = input.label ? parseCustomerLabel(input.label) : null;
  const phone = input.phone ? parsePhone(input.phone) : null;
  const notes = input.notes ? parseNotes(input.notes) : null;

  return withVerifiedBusiness(pool, access, 'customer.create', async (c, fresh) => {
    await assertWritable(c, fresh.businessId);
    await assertIdentityFree(c, fresh.businessId, name.normalized, label?.normalized ?? null, null);
    try {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO customers (business_id, name, normalized_name, label, normalized_label, phone, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          fresh.businessId,
          name.display,
          name.normalized,
          label?.display ?? null,
          label?.normalized ?? null,
          phone,
          notes,
          fresh.userId,
        ],
      );
      const id = rows[0]!.id;
      const created = await loadCustomer(c, id);
      await audit(c, fresh, 'customer.create', id, null, {
        name: name.display,
        label: label?.display ?? null,
      });
      return created;
    } catch (error) {
      // Parallel ikkita bir xil mijoz: oldindan tekshiruvdan o'tib ketgan poyga
      if (isIdentityViolation(error)) {
        throw new ConflictError('Bunday mijoz allaqachon bor', {
          details: { reason: 'DUPLICATE_IDENTITY' },
        });
      }
      throw error;
    }
  });
}

async function loadCustomer(c: PoolClient, id: string): Promise<Customer> {
  const { rows } = await c.query<CustomerRow>(`${SELECT} WHERE c.id = $1`, [id]);
  if (!rows[0]) throw new NotFoundError('Mijoz topilmadi');
  return toCustomer(rows[0]);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const assertUuid = (id: string): void => {
  if (!UUID.test(id)) throw new NotFoundError('Mijoz topilmadi');
};

/** Boshqa biznes mijozi RLS tufayli ko'rinmaydi → NotFound (mavjudligi oshkor qilinmaydi). */
export async function getCustomer(
  pool: Pool,
  access: BusinessAccess,
  id: string,
): Promise<Customer> {
  assertUuid(id);
  return withBusiness(pool, access, (c) => loadCustomer(c, id), 'customer.view');
}

export interface UpdateCustomerInput {
  readonly name?: string;
  readonly label?: string | null;
  readonly phone?: string | null;
  readonly notes?: string | null;
}

export async function updateCustomer(
  pool: Pool,
  access: BusinessAccess,
  id: string,
  patch: UpdateCustomerInput,
): Promise<Customer> {
  assertUuid(id);
  const name = patch.name !== undefined ? parseCustomerName(patch.name) : undefined;
  // undefined = o'zgartirilmaydi; null yoki bo'sh qator = tozalash
  const label =
    patch.label === undefined ? undefined : patch.label ? parseCustomerLabel(patch.label) : null;
  const phone =
    patch.phone === undefined ? undefined : patch.phone ? parsePhone(patch.phone) : null;
  const notes =
    patch.notes === undefined ? undefined : patch.notes ? parseNotes(patch.notes) : null;

  return withVerifiedBusiness(pool, access, 'customer.update', async (c, fresh) => {
    await assertWritable(c, fresh.businessId);
    const { rows } = await c.query<{
      name: string;
      normalized_name: string;
      label: string | null;
      normalized_label: string | null;
      phone: string | null;
      notes: string | null;
      status: CustomerStatus;
    }>(
      `SELECT name, normalized_name, label, normalized_label, phone, notes, status
         FROM customers WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const before = rows[0];
    if (!before) throw new NotFoundError('Mijoz topilmadi');

    const next = {
      name: name?.display ?? before.name,
      normalizedName: name?.normalized ?? before.normalized_name,
      label: label === undefined ? before.label : (label?.display ?? null),
      normalizedLabel: label === undefined ? before.normalized_label : (label?.normalized ?? null),
      phone: phone === undefined ? before.phone : phone,
      notes: notes === undefined ? before.notes : notes,
    };
    if (before.status === 'ACTIVE') {
      await assertIdentityFree(c, fresh.businessId, next.normalizedName, next.normalizedLabel, id);
    }
    try {
      await c.query(
        `UPDATE customers
            SET name = $2, normalized_name = $3, label = $4, normalized_label = $5, phone = $6, notes = $7
          WHERE id = $1`,
        [
          id,
          next.name,
          next.normalizedName,
          next.label,
          next.normalizedLabel,
          next.phone,
          next.notes,
        ],
      );
    } catch (error) {
      if (isIdentityViolation(error)) {
        throw new ConflictError('Bunday mijoz allaqachon bor', {
          details: { reason: 'DUPLICATE_IDENTITY' },
        });
      }
      throw error;
    }
    await audit(
      c,
      fresh,
      'customer.update',
      id,
      {
        name: before.name,
        label: before.label,
        phone: before.phone !== null,
        notes: before.notes !== null,
      },
      {
        name: next.name,
        label: next.label,
        phone: next.phone !== null,
        notes: next.notes !== null,
      },
    );
    return loadCustomer(c, id);
  });
}

/**
 * Arxivlash (mijoz o'chirilmaydi, ADR-0002 §11): faqat OWNER va faqat balans 0 bo'lganda.
 * Yagona qulf nuqtasi: mijoz qatori (`FOR UPDATE`). Balans qatoriga ilova roli yoza olmagani uchun uni
 * qulflab bo'lmaydi (FOR UPDATE UPDATE huquqini talab qiladi) va kerak ham emas: LedgerService ham avval
 * shu qatorni qulflaydi, shuning uchun balans o'qilgandan keyin o'zgarmaydi.
 */
export async function archiveCustomer(
  pool: Pool,
  access: BusinessAccess,
  id: string,
): Promise<Customer> {
  assertUuid(id);
  return withVerifiedBusiness(pool, access, 'customer.archive', async (c, fresh) => {
    await assertWritable(c, fresh.businessId);
    const locked = await c.query<{ status: CustomerStatus }>(
      'SELECT status FROM customers WHERE id = $1 FOR UPDATE',
      [id],
    );
    if (!locked.rows[0]) throw new NotFoundError('Mijoz topilmadi');
    const bal = await c.query<{ balance: string }>(
      'SELECT balance FROM customer_balances WHERE customer_id = $1',
      [id],
    );
    const balance = Number(bal.rows[0]!.balance);
    if (balance !== 0) {
      throw new ConflictError('Qarzi bor mijozni arxivlab bo‘lmaydi', {
        details: { reason: 'BALANCE_NOT_ZERO', balance },
      });
    }
    if (locked.rows[0].status === 'ARCHIVED') return loadCustomer(c, id);
    await c.query("UPDATE customers SET status = 'ARCHIVED' WHERE id = $1", [id]);
    await audit(c, fresh, 'customer.archive', id, { status: 'ACTIVE' }, { status: 'ARCHIVED' });
    return loadCustomer(c, id);
  });
}

export async function unarchiveCustomer(
  pool: Pool,
  access: BusinessAccess,
  id: string,
): Promise<Customer> {
  assertUuid(id);
  return withVerifiedBusiness(pool, access, 'customer.unarchive', async (c, fresh) => {
    await assertWritable(c, fresh.businessId);
    const { rows } = await c.query<{
      normalized_name: string;
      normalized_label: string | null;
      status: CustomerStatus;
    }>('SELECT normalized_name, normalized_label, status FROM customers WHERE id = $1 FOR UPDATE', [
      id,
    ]);
    const row = rows[0];
    if (!row) throw new NotFoundError('Mijoz topilmadi');
    if (row.status === 'ACTIVE') return loadCustomer(c, id);
    await assertIdentityFree(c, fresh.businessId, row.normalized_name, row.normalized_label, id);
    try {
      await c.query("UPDATE customers SET status = 'ACTIVE' WHERE id = $1", [id]);
    } catch (error) {
      if (isIdentityViolation(error)) {
        throw new ConflictError('Bunday mijoz allaqachon bor', {
          details: { reason: 'DUPLICATE_IDENTITY' },
        });
      }
      throw error;
    }
    await audit(c, fresh, 'customer.unarchive', id, { status: 'ARCHIVED' }, { status: 'ACTIVE' });
    return loadCustomer(c, id);
  });
}

// ───────── Qidiruv, saralash, kursor bo'yicha sahifalash ─────────

/** recent: oxirgi yozuv (yoki yaratilish) vaqti bo'yicha, eng yangisi birinchi. */
export type CustomerSort = 'debt' | 'newest' | 'name' | 'recent';

export interface SearchCustomersInput {
  readonly q?: string;
  readonly sort?: CustomerSort;
  readonly limit?: number;
  readonly cursor?: string;
  readonly status?: CustomerStatus;
  readonly onlyDebtors?: boolean;
}

export interface CustomerPage {
  readonly items: Customer[];
  readonly nextCursor: string | null;
}

const cursorSchema = z.discriminatedUnion('s', [
  z.object({ s: z.literal('debt'), v: z.string().regex(/^\d+$/), id: z.string().uuid() }),
  z.object({ s: z.literal('newest'), v: z.string().min(10).max(40), id: z.string().uuid() }),
  z.object({ s: z.literal('name'), v: z.string().max(200), id: z.string().uuid() }),
  z.object({ s: z.literal('recent'), v: z.string().min(10).max(40), id: z.string().uuid() }),
]);

const encodeCursor = (c: z.infer<typeof cursorSchema>): string =>
  Buffer.from(JSON.stringify(c)).toString('base64url');

function decodeCursor(raw: string, sort: CustomerSort): z.infer<typeof cursorSchema> {
  try {
    const parsed = cursorSchema.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
    if (parsed.s !== sort) throw new Error('sort mos emas');
    return parsed;
  } catch {
    throw new ValidationError('cursor yaroqsiz', { details: { field: 'cursor' } });
  }
}

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export async function searchCustomers(
  pool: Pool,
  access: BusinessAccess,
  input: SearchCustomersInput = {},
): Promise<CustomerPage> {
  const sort = input.sort ?? 'name';
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 20), 1), 100);
  const where: string[] = ['c.status = $1'];
  const params: unknown[] = [input.status ?? 'ACTIVE'];
  const add = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  if (input.onlyDebtors) where.push('b.balance > 0');

  if (input.q) {
    const q = normalizeName(input.q);
    if (q) {
      const like = `%${escapeLike(q)}%`;
      const p = add(like);
      const conds = [`c.normalized_name LIKE ${p}`, `c.normalized_label LIKE ${p}`];
      const digits = input.q.replace(/\D/g, '');
      if (digits.length >= 3) conds.push(`c.phone LIKE ${add(`%${digits}%`)}`);
      where.push(`(${conds.join(' OR ')})`);
    }
  }

  let orderBy: string;
  let cursorValueSql = '';
  if (sort === 'debt') {
    orderBy = 'b.balance DESC, c.id ASC';
    cursorValueSql = 'b.balance::text';
    if (input.cursor) {
      const cur = decodeCursor(input.cursor, sort);
      const v = add(cur.v);
      const id = add(cur.id);
      where.push(`(b.balance < ${v}::bigint OR (b.balance = ${v}::bigint AND c.id > ${id}::uuid))`);
    }
  } else if (sort === 'newest') {
    orderBy = 'c.created_at DESC, c.id ASC';
    cursorValueSql = 'c.created_at::text';
    if (input.cursor) {
      const cur = decodeCursor(input.cursor, sort);
      const v = add(cur.v);
      const id = add(cur.id);
      where.push(
        `(c.created_at < ${v}::timestamptz OR (c.created_at = ${v}::timestamptz AND c.id > ${id}::uuid))`,
      );
    }
  } else if (sort === 'recent') {
    orderBy = 'b.updated_at DESC, c.id ASC';
    cursorValueSql = 'b.updated_at::text';
    if (input.cursor) {
      const cur = decodeCursor(input.cursor, sort);
      const v = add(cur.v);
      const id = add(cur.id);
      where.push(
        `(b.updated_at < ${v}::timestamptz OR (b.updated_at = ${v}::timestamptz AND c.id > ${id}::uuid))`,
      );
    }
  } else {
    orderBy = 'c.normalized_name ASC, c.id ASC';
    cursorValueSql = 'c.normalized_name';
    if (input.cursor) {
      const cur = decodeCursor(input.cursor, sort);
      const v = add(cur.v);
      const id = add(cur.id);
      where.push(`(c.normalized_name > ${v} OR (c.normalized_name = ${v} AND c.id > ${id}::uuid))`);
    }
  }

  const limitParam = add(limit + 1);
  const rows = await withBusiness(
    pool,
    access,
    async (c) =>
      (
        await c.query<CustomerRow & { cursor_value: string }>(
          `${SELECT.replace('SELECT c.id,', `SELECT ${cursorValueSql} AS cursor_value, c.id,`)}
            WHERE ${where.join(' AND ')}
            ORDER BY ${orderBy}
            LIMIT ${limitParam}`,
          params,
        )
      ).rows,
    'customer.view',
  );

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const hasMore = rows.length > limit;
  return {
    items: page.map(toCustomer),
    nextCursor:
      hasMore && last ? encodeCursor({ s: sort, v: last.cursor_value, id: last.id }) : null,
  };
}
