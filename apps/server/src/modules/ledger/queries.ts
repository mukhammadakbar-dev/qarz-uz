import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '../../errors/index.js';
import type { Logger } from '../../observability/logger.js';
import { withBusiness, type BusinessAccess } from '../tenancy/index.js';
import { ENTRY_COLUMNS, toEntry, type LedgerEntry } from './service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function balanceOf(c: PoolClient, customerId: string): Promise<number> {
  if (!UUID.test(customerId)) throw new NotFoundError('Mijoz topilmadi');
  const { rows } = await c.query<{ balance: string }>(
    'SELECT balance FROM customer_balances WHERE customer_id = $1',
    [customerId],
  );
  if (!rows[0]) throw new NotFoundError('Mijoz topilmadi'); // boshqa biznes mijozi ham shu yerga tushadi (RLS)
  return Number(rows[0].balance);
}

/** Joriy qoldiq (proyeksiyadan; haqiqat manbai ledger, reconcile ularni solishtiradi). */
export const getBalance = (
  pool: Pool,
  access: BusinessAccess,
  customerId: string,
): Promise<number> => withBusiness(pool, access, (c) => balanceOf(c, customerId), 'customer.view');

export interface PaymentPreview {
  readonly balance: number;
  /** Eng ko'pi bilan qancha to'lash mumkin (= qoldiq). 0 = qarzi yo'q. */
  readonly maxPayable: number;
  /** Shu summani to'lasa ruxsat etiladimi (ortiqcha emas, summa > 0). */
  readonly allowed: boolean;
  readonly balanceAfter: number | null;
}

/** Yozmaydi. Bot/Mini App tasdiq oynasi uchun; yakuniy qaror baribir LedgerService'da. */
export const previewPayment = (
  pool: Pool,
  access: BusinessAccess,
  customerId: string,
  amount: number,
): Promise<PaymentPreview> =>
  withBusiness(
    pool,
    access,
    async (c) => {
      const balance = await balanceOf(c, customerId);
      const allowed = Number.isSafeInteger(amount) && amount >= 1 && amount <= balance;
      return {
        balance,
        maxPayable: balance,
        allowed,
        balanceAfter: allowed ? balance - amount : null,
      };
    },
    'ledger.payment',
  );

export interface DebtPreview {
  readonly balance: number;
  readonly balanceAfter: number;
}

export const previewDebt = (
  pool: Pool,
  access: BusinessAccess,
  customerId: string,
  amount: number,
): Promise<DebtPreview> =>
  withBusiness(
    pool,
    access,
    async (c) => {
      const balance = await balanceOf(c, customerId);
      return { balance, balanceAfter: balance + amount };
    },
    'ledger.debt',
  );

/**
 * Idempotency kaliti bo'yicha yozuv (qoralama tasdig'ida qayta urinishni aniqlash uchun). Boshqa biznes kaliti ko'rinmaydi.
 */
export const findEntryByIdempotencyKey = (
  pool: Pool,
  access: BusinessAccess,
  key: string,
): Promise<LedgerEntry | undefined> =>
  withBusiness(
    pool,
    access,
    async (c) => {
      const { rows } = await c.query<Parameters<typeof toEntry>[0]>(
        `SELECT ${ENTRY_COLUMNS} FROM ledger_entries WHERE business_id = $1 AND idempotency_key = $2`,
        [access.businessId, key],
      );
      return rows[0] ? toEntry(rows[0]) : undefined;
    },
    'ledger.history.view',
  );

// ───────── Tarix ─────────

export interface HistoryItem extends LedgerEntry {
  /** Shu yozuvdan keyingi qoldiq (seq tartibida, ADR-0002 §8). */
  readonly runningBalance: number;
  /** Bu yozuv storno qilingan bo'lsa — storno yozuvi ID si. */
  readonly reversedBy: string | null;
  /** Bu yozuv o'zi storno (tarixda "o'chirish" belgisi sifatida). */
  readonly isReversal: boolean;
  readonly createdByName: string | null;
}

export interface HistoryPage {
  readonly items: HistoryItem[];
  readonly nextCursor: string | null;
}

const cursorSchema = z.object({ before: z.string().regex(/^\d{1,18}$/) });

export async function getHistory(
  pool: Pool,
  access: BusinessAccess,
  customerId: string,
  options: { limit?: number; cursor?: string } = {},
): Promise<HistoryPage> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 20), 1), 100);
  let before: string | null = null;
  if (options.cursor) {
    try {
      before = cursorSchema.parse(
        JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8')),
      ).before;
    } catch {
      throw new ValidationError('cursor yaroqsiz', { details: { field: 'cursor' } });
    }
  }

  return withBusiness(
    pool,
    access,
    async (c) => {
      await balanceOf(c, customerId); // mijoz ko'rinishini tekshiradi (NotFound)
      // Qoldiq butun tarix bo'yicha hisoblanadi, keyin sahifalanadi (oyna funksiyasi LIMIT dan oldin ishlaydi)
      const { rows } = await c.query<
        Parameters<typeof toEntry>[0] & {
          running: string;
          reversed_by: string | null;
          created_by_name: string | null;
        }
      >(
        `WITH h AS (
           SELECT ${ENTRY_COLUMNS.split(', ')
             .map((col) => `e.${col}`)
             .join(', ')},
                  sum(e.delta) OVER (ORDER BY e.seq) AS running,
                  r.id AS reversed_by,
                  u.first_name AS created_by_name
             FROM ledger_entries e
             LEFT JOIN ledger_entries r ON r.reverses_entry_id = e.id
             LEFT JOIN users u ON u.id = e.created_by
            WHERE e.customer_id = $1
         )
         SELECT * FROM h
          WHERE ($2::bigint IS NULL OR seq < $2::bigint)
          ORDER BY seq DESC
          LIMIT $3`,
        [customerId, before, limit + 1],
      );
      const page = rows.slice(0, limit);
      const items: HistoryItem[] = page.map((r) => ({
        ...toEntry(r),
        runningBalance: Number(r.running),
        reversedBy: r.reversed_by,
        isReversal: r.reverses_entry_id !== null,
        createdByName: r.created_by_name,
      }));
      const last = items.at(-1);
      return {
        items,
        nextCursor:
          rows.length > limit && last
            ? Buffer.from(JSON.stringify({ before: String(last.seq) })).toString('base64url')
            : null,
      };
    },
    'ledger.history.view',
  );
}

// ───────── Dashboard (TT §31) ─────────

export interface BusinessSummary {
  readonly totalDebt: number;
  readonly debtorsCount: number;
  /** Bugungi (biznes vaqt zonasi bo'yicha) qarz va to'lov yozuvlari soni; storno hisoblanmaydi. */
  readonly todayOperations: number;
}

export const getBusinessSummary = (pool: Pool, access: BusinessAccess): Promise<BusinessSummary> =>
  withBusiness(
    pool,
    access,
    async (c) => {
      const { rows } = await c.query<{ total: string; debtors: string; today: string }>(
        `SELECT
           (SELECT COALESCE(sum(b.balance), 0) FROM customer_balances b
              JOIN customers cu ON cu.id = b.customer_id WHERE cu.status = 'ACTIVE') AS total,
           (SELECT count(*) FROM customer_balances b
              JOIN customers cu ON cu.id = b.customer_id WHERE cu.status = 'ACTIVE' AND b.balance > 0) AS debtors,
           (SELECT count(*) FROM ledger_entries e
              JOIN businesses bz ON bz.id = e.business_id
             WHERE e.type IN ('DEBT', 'PAYMENT')
               AND (e.created_at AT TIME ZONE bz.timezone)::date = (now() AT TIME ZONE bz.timezone)::date) AS today`,
      );
      const r = rows[0]!;
      return {
        totalDebt: Number(r.total),
        debtorsCount: Number(r.debtors),
        todayOperations: Number(r.today),
      };
    },
    'customer.view',
  );

// ───────── Reconciliation (ADR-0002 §9) ─────────

export interface BalanceMismatch {
  readonly customerId: string;
  readonly businessId: string;
  readonly projected: number;
  readonly ledgerSum: number;
}

/**
 * Proyeksiya (customer_balances) ni ledger'ning SUM(delta) bilan solishtiradi. `nasiya_system` pool bilan
 * (cross-tenant). Avtomatik TUZATMAYDI: faqat xabar beradi — pul masalasida odam tekshiradi.
 */
export async function findBalanceMismatches(system: Pool): Promise<BalanceMismatch[]> {
  const { rows } = await system.query<{
    customer_id: string;
    business_id: string;
    balance: string;
    ledger_sum: string;
  }>(
    `SELECT b.customer_id, b.business_id, b.balance, COALESCE(s.total, 0) AS ledger_sum
       FROM customer_balances b
       LEFT JOIN (SELECT customer_id, sum(delta) AS total FROM ledger_entries GROUP BY customer_id) s
         ON s.customer_id = b.customer_id
      WHERE b.balance <> COALESCE(s.total, 0)`,
  );
  return rows.map((r) => ({
    customerId: r.customer_id,
    businessId: r.business_id,
    projected: Number(r.balance),
    ledgerSum: Number(r.ledger_sum),
  }));
}

export async function reconcileBalances(system: Pool, logger: Logger): Promise<BalanceMismatch[]> {
  const mismatches = await findBalanceMismatches(system);
  for (const m of mismatches) {
    logger.error(
      {
        customerId: m.customerId,
        businessId: m.businessId,
        projected: m.projected,
        ledgerSum: m.ledgerSum,
      },
      'BALANS NOMOSLIGI: proyeksiya ledger yig‘indisiga teng emas',
    );
  }
  if (mismatches.length === 0) logger.info('balanslar ledger bilan mos');
  return mismatches;
}
