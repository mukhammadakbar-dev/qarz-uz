import { isValidAmount, MAX_AMOUNT_UZS } from '@nasiya/shared';
import type { Pool, PoolClient } from 'pg';
import {
  ConflictError,
  NotFoundError,
  OverpaymentError,
  ValidationError,
} from '../../errors/index.js';
import { getContext } from '../../observability/context.js';
import { assertWritable } from '../billing/guard.js';
import { withVerifiedBusiness, type BusinessAccess, type Permission } from '../tenancy/index.js';

export type EntryType = 'DEBT' | 'PAYMENT' | 'ADJUSTMENT';
export type EntrySource = 'BOT' | 'MINIAPP' | 'SYSTEM';

export interface LedgerEntry {
  readonly id: string;
  readonly seq: number;
  readonly customerId: string;
  readonly type: EntryType;
  /** DEBT/PAYMENT: musbat; ADJUSTMENT: ishorali. */
  readonly amount: number;
  /** Balansga ta'siri: DEBT +, PAYMENT −, ADJUSTMENT ishorali. */
  readonly delta: number;
  readonly description: string | null;
  readonly occurredAt: Date;
  readonly createdBy: string;
  readonly source: EntrySource;
  readonly reversesEntryId: string | null;
  readonly createdAt: Date;
}

export interface PostResult {
  readonly entry: LedgerEntry;
  /** Yozuvdan keyingi qoldiq. */
  readonly balance: number;
  /** Shu idempotency kaliti bilan oldin saqlangan yozuv qaytarildi (yangi yozuv yaratilmadi). */
  readonly replayed: boolean;
}

export interface PostInput {
  readonly customerId: string;
  readonly amount: number;
  /** Bot: draft ID; Mini App: Idempotency-Key. Biznes ichida noyob (ADR-0003). */
  readonly idempotencyKey: string;
  readonly description?: string | null;
  /** 0 = bugun, -1 = kecha. Kelajak taqiqlangan, 365 kundan eski taqiqlangan. */
  readonly dateOffsetDays?: number;
  readonly source: EntrySource;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

interface EntryRow {
  id: string;
  seq: string;
  customer_id: string;
  type: EntryType;
  amount: string;
  delta: string;
  description: string | null;
  occurred_at: Date;
  created_by: string;
  source: EntrySource;
  reverses_entry_id: string | null;
  created_at: Date;
}

export const ENTRY_COLUMNS =
  'id, seq, customer_id, type, amount, delta, description, occurred_at, created_by, source, reverses_entry_id, created_at';

export const toEntry = (r: EntryRow): LedgerEntry => ({
  id: r.id,
  seq: Number(r.seq),
  customerId: r.customer_id,
  type: r.type,
  amount: Number(r.amount),
  delta: Number(r.delta),
  description: r.description,
  occurredAt: r.occurred_at,
  createdBy: r.created_by,
  source: r.source,
  reversesEntryId: r.reverses_entry_id,
  createdAt: r.created_at,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BALANCE_CHECK = 'customer_balances_balance_check';
const IDEMPOTENCY_UQ = 'ledger_idempotency_uq';

const pgError = (e: unknown) => e as { code?: string; constraint?: string };

function validateCommon(
  input: Pick<PostInput, 'idempotencyKey' | 'dateOffsetDays' | 'description'>,
): number {
  const key = input.idempotencyKey;
  if (typeof key !== 'string' || key.length < 1 || key.length > 128) {
    throw new ValidationError('idempotencyKey 1..128 belgi bo‘lishi kerak', {
      details: { field: 'idempotencyKey' },
    });
  }
  const offset = input.dateOffsetDays ?? 0;
  if (!Number.isInteger(offset) || offset > 0 || offset < -365) {
    throw new ValidationError('Sana kelajakda yoki 365 kundan eski bo‘lishi mumkin emas', {
      details: { field: 'dateOffsetDays' },
    });
  }
  if (input.description != null && input.description.length > 500) {
    throw new ValidationError('description juda uzun', { details: { field: 'description' } });
  }
  return offset;
}

function validateAmount(type: EntryType, amount: number): void {
  const ok =
    type === 'ADJUSTMENT'
      ? Number.isSafeInteger(amount) && amount !== 0 && Math.abs(amount) <= MAX_AMOUNT_UZS
      : isValidAmount(amount);
  if (!ok) throw new ValidationError('Summa yaroqsiz', { details: { field: 'amount' } });
}

/**
 * Mijoz qatorini qulflaydi — barcha moliyaviy yozuvlar uchun YAGONA qulf nuqtasi (ADR-0002 §10).
 * Qulfdan keyin balans o'qilgandan so'ng o'zgara olmaydi.
 */
async function lockCustomer(
  c: PoolClient,
  customerId: string,
): Promise<{ status: 'ACTIVE' | 'ARCHIVED' }> {
  if (!UUID.test(customerId)) throw new NotFoundError('Mijoz topilmadi');
  const { rows } = await c.query<{ status: 'ACTIVE' | 'ARCHIVED' }>(
    'SELECT status FROM customers WHERE id = $1 FOR UPDATE',
    [customerId],
  );
  if (!rows[0]) throw new NotFoundError('Mijoz topilmadi'); // boshqa biznes mijozi ham shu yerga tushadi (RLS)
  return rows[0];
}

async function readBalance(c: PoolClient, customerId: string): Promise<number> {
  const { rows } = await c.query<{ balance: string }>(
    'SELECT balance FROM customer_balances WHERE customer_id = $1',
    [customerId],
  );
  return Number(rows[0]!.balance);
}

async function findByKey(
  c: PoolClient,
  businessId: string,
  key: string,
): Promise<LedgerEntry | undefined> {
  const { rows } = await c.query<EntryRow>(
    `SELECT ${ENTRY_COLUMNS} FROM ledger_entries WHERE business_id = $1 AND idempotency_key = $2`,
    [businessId, key],
  );
  return rows[0] ? toEntry(rows[0]) : undefined;
}

const keyReused = () =>
  new ConflictError('Idempotency kaliti boshqa operatsiya uchun ishlatilgan', {
    details: { reason: 'IDEMPOTENCY_KEY_REUSED' },
  });

async function audit(
  c: PoolClient,
  access: BusinessAccess,
  action: string,
  entryId: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  await c.query(
    `INSERT INTO audit_logs (business_id, actor_user_id, action, entity, entity_id, before, after, request_id)
     VALUES ($1, $2, $3, 'ledger_entry', $4::text, $5::jsonb, $6::jsonb, $7)`,
    [
      access.businessId,
      access.userId,
      action,
      entryId,
      before === null ? null : JSON.stringify(before),
      after === null ? null : JSON.stringify(after),
      getContext()?.requestId ?? null,
    ],
  );
}

async function postEntry(
  pool: Pool,
  access: BusinessAccess,
  type: EntryType,
  permission: Permission,
  input: PostInput,
): Promise<PostResult> {
  const offsetDays = validateCommon(input);
  validateAmount(type, input.amount);
  if (type === 'ADJUSTMENT' && !input.description?.trim()) {
    throw new ValidationError('Tuzatish sababi majburiy', { details: { field: 'description' } });
  }

  return withVerifiedBusiness(pool, access, permission, async (c, fresh) => {
    await assertWritable(c, fresh.businessId);
    const customer = await lockCustomer(c, input.customerId);

    // Idempotentlik: qulfdan KEYIN tekshiriladi, shuning uchun parallel takroriy so'rov toza replay oladi
    const existing = await findByKey(c, fresh.businessId, input.idempotencyKey);
    if (existing) {
      if (
        existing.customerId !== input.customerId ||
        existing.type !== type ||
        existing.amount !== input.amount ||
        existing.reversesEntryId !== null
      ) {
        throw keyReused();
      }
      return {
        entry: existing,
        balance: await readBalance(c, existing.customerId),
        replayed: true,
      };
    }

    if (customer.status === 'ARCHIVED') {
      throw new ConflictError('Mijoz arxivda', { details: { reason: 'CUSTOMER_ARCHIVED' } });
    }

    const balance = await readBalance(c, input.customerId);
    if (type === 'PAYMENT' && input.amount > balance) throw new OverpaymentError(balance);
    if (type === 'ADJUSTMENT' && balance + input.amount < 0) {
      throw new ConflictError('Tuzatish qoldiqni manfiy qiladi', {
        details: { reason: 'ADJUSTMENT_WOULD_OVERDRAW', balance },
      });
    }

    let entry: LedgerEntry;
    try {
      const { rows } = await c.query<EntryRow>(
        `INSERT INTO ledger_entries
           (business_id, customer_id, type, amount, description, occurred_at, created_by, source,
            idempotency_key, metadata)
         VALUES ($1, $2, $3, $4, $5, now() - make_interval(days => $6), $7, $8, $9, $10::jsonb)
         RETURNING ${ENTRY_COLUMNS}`,
        [
          fresh.businessId,
          input.customerId,
          type,
          input.amount,
          input.description?.trim() || null,
          -offsetDays,
          fresh.userId,
          input.source,
          input.idempotencyKey,
          JSON.stringify(input.metadata ?? {}),
        ],
      );
      entry = toEntry(rows[0]!);
    } catch (error) {
      // Oxirgi himoya chizig'i: DB CHECK. Oldindan tekshiruv o'tkazib yuborgan bo'lsa ham ortiqcha to'lov yozilmaydi.
      if (pgError(error).code === '23514' && pgError(error).constraint === BALANCE_CHECK) {
        throw new OverpaymentError(balance);
      }
      if (pgError(error).code === '23505' && pgError(error).constraint === IDEMPOTENCY_UQ) {
        throw keyReused();
      }
      throw error;
    }

    await audit(c, fresh, `ledger.${type.toLowerCase()}`, entry.id, null, {
      customerId: entry.customerId,
      type: entry.type,
      amount: entry.amount,
      source: entry.source,
    });
    return { entry, balance: await readBalance(c, input.customerId), replayed: false };
  });
}

/** Nasiya yozish. */
export const postDebt = (
  pool: Pool,
  access: BusinessAccess,
  input: PostInput,
): Promise<PostResult> => postEntry(pool, access, 'DEBT', 'ledger.debt', input);

/**
 * To'lov. Qarzdan ko'p bo'lsa HECH QACHON yozilmaydi (Q1): OverpaymentError(maxPayable).
 * maxPayable === 0 — qarzi yo'q mijoz.
 */
export const postPayment = (
  pool: Pool,
  access: BusinessAccess,
  input: PostInput,
): Promise<PostResult> => postEntry(pool, access, 'PAYMENT', 'ledger.payment', input);

/** Qo'lda tuzatish (faqat OWNER). `amount` ishorali, sabab majburiy; natijaviy qoldiq >= 0. */
export const postAdjustment = (
  pool: Pool,
  access: BusinessAccess,
  input: PostInput,
): Promise<PostResult> => postEntry(pool, access, 'ADJUSTMENT', 'ledger.adjustment', input);

// ───────── Storno ("o'chirish", ADR-0002 §5) ─────────

export interface DeleteEntryInput {
  readonly entryId: string;
  readonly idempotencyKey: string;
  readonly reason?: string | null;
  readonly source: EntrySource;
}

export interface DeleteEntryResult extends PostResult {
  /** O'chirilgan (asl) yozuv. */
  readonly original: LedgerEntry;
  /** Egasiga xabar yuborilsinmi (staff o'chirdi va biznes sozlamasi yoqilgan, D-b). */
  readonly notifyOwner: boolean;
}

export async function deleteEntry(
  pool: Pool,
  access: BusinessAccess,
  input: DeleteEntryInput,
): Promise<DeleteEntryResult> {
  validateCommon({ idempotencyKey: input.idempotencyKey, description: input.reason });
  if (!UUID.test(input.entryId)) throw new NotFoundError('Yozuv topilmadi');

  return withVerifiedBusiness(pool, access, 'ledger.entry.delete', async (c, fresh) => {
    await assertWritable(c, fresh.businessId);

    const target = await c.query<EntryRow>(
      `SELECT ${ENTRY_COLUMNS} FROM ledger_entries WHERE id = $1`,
      [input.entryId],
    );
    if (!target.rows[0]) throw new NotFoundError('Yozuv topilmadi');
    const original = toEntry(target.rows[0]);

    const customer = await lockCustomer(c, original.customerId);

    const notifyRow = await c.query<{ notify_owner_on_delete: boolean }>(
      'SELECT notify_owner_on_delete FROM businesses WHERE id = $1',
      [fresh.businessId],
    );
    const notifyOwner =
      fresh.role === 'STAFF' && (notifyRow.rows[0]?.notify_owner_on_delete ?? false);

    // Takroriy chaqiruv: xuddi shu kalit shu yozuvning stornosi bo'lsa — replay
    const existing = await findByKey(c, fresh.businessId, input.idempotencyKey);
    if (existing) {
      if (existing.reversesEntryId !== original.id) throw keyReused();
      return {
        entry: existing,
        original,
        balance: await readBalance(c, original.customerId),
        replayed: true,
        notifyOwner: false,
      };
    }

    if (original.reversesEntryId !== null) {
      throw new ConflictError('Storno yozuvini o‘chirib bo‘lmaydi', {
        details: { reason: 'CANNOT_REVERSE_REVERSAL' },
      });
    }
    const already = await c.query('SELECT 1 FROM ledger_entries WHERE reverses_entry_id = $1', [
      original.id,
    ]);
    if (already.rowCount) {
      throw new ConflictError('Yozuv allaqachon o‘chirilgan', {
        details: { reason: 'ALREADY_REVERSED' },
      });
    }
    if (customer.status === 'ARCHIVED') {
      throw new ConflictError('Mijoz arxivda', { details: { reason: 'CUSTOMER_ARCHIVED' } });
    }

    const balance = await readBalance(c, original.customerId);
    const stornoAmount = -original.delta;
    if (balance + stornoAmount < 0) {
      // Masalan: to'lovlari bor nasiyani o'chirish. "Avval keyingi to'lovlarni o'chiring."
      throw new ConflictError('Avval keyingi to‘lovlarni o‘chiring', {
        details: { reason: 'REVERSAL_WOULD_OVERDRAW', balance },
      });
    }

    let entry: LedgerEntry;
    try {
      const { rows } = await c.query<EntryRow>(
        `INSERT INTO ledger_entries
           (business_id, customer_id, type, amount, description, created_by, source,
            idempotency_key, reverses_entry_id, metadata)
         VALUES ($1, $2, 'ADJUSTMENT', $3, $4, $5, $6, $7, $8, $9::jsonb)
         RETURNING ${ENTRY_COLUMNS}`,
        [
          fresh.businessId,
          original.customerId,
          stornoAmount,
          input.reason?.trim() || null,
          fresh.userId,
          input.source,
          input.idempotencyKey,
          original.id,
          JSON.stringify({ reversal: true, originalType: original.type }),
        ],
      );
      entry = toEntry(rows[0]!);
    } catch (error) {
      if (pgError(error).code === '23514' && pgError(error).constraint === BALANCE_CHECK) {
        throw new ConflictError('Avval keyingi to‘lovlarni o‘chiring', {
          details: { reason: 'REVERSAL_WOULD_OVERDRAW', balance },
        });
      }
      if (pgError(error).code === '23505') {
        throw keyReused();
      }
      throw error;
    }

    await audit(
      c,
      fresh,
      'ledger.entry.delete',
      original.id,
      { type: original.type, amount: original.amount, customerId: original.customerId },
      { reversalEntryId: entry.id, reason: input.reason?.trim() || null },
    );
    return {
      entry,
      original,
      balance: await readBalance(c, original.customerId),
      replayed: false,
      notifyOwner,
    };
  });
}
