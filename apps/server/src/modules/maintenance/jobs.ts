import type { Pool } from 'pg';
import type { Logger } from '../../observability/logger.js';
import { reconcileBalances } from '../ledger/index.js';

/**
 * Davriy xizmat vazifalari (`nasiya_system` pool, cross-tenant). Bir nechta instance bo'lsa ham bir vaqtda
 * faqat bittasi ishlaydi (pg advisory lock).
 */

export const RETENTION = {
  /** Interpretatsiya jurnali (ADR-0004 §13). */
  interpretationsDays: 30,
  /** Telegram update dedupe: Telegram qayta yuborish oynasidan ancha katta. */
  processedUpdatesDays: 7,
} as const;

export interface MaintenanceResult {
  readonly ranJobs: boolean;
  readonly interpretationsDeleted: number;
  readonly updatesDeleted: number;
  readonly draftsExpired: number;
  readonly statesDeleted: number;
  readonly balanceMismatches: number;
}

const LOCK_KEY = 'nasiya:maintenance';

export async function runMaintenance(system: Pool, logger: Logger): Promise<MaintenanceResult> {
  const client = await system.connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
      [LOCK_KEY],
    );
    if (!rows[0]?.locked) {
      return {
        ranJobs: false,
        interpretationsDeleted: 0,
        updatesDeleted: 0,
        draftsExpired: 0,
        statesDeleted: 0,
        balanceMismatches: 0,
      };
    }
    try {
      const interpretations = await client.query(
        'DELETE FROM ai_interpretations WHERE created_at < now() - make_interval(days => $1)',
        [RETENTION.interpretationsDays],
      );
      const updates = await client.query(
        'DELETE FROM processed_updates WHERE received_at < now() - make_interval(days => $1)',
        [RETENTION.processedUpdatesDays],
      );
      // Muddati o'tgan qoralamalar: tugmalar bosilmasa ham holat to'g'ri ko'rinsin
      const drafts = await client.query(
        "UPDATE pending_operations SET status = 'EXPIRED' WHERE status = 'PENDING' AND expires_at <= now()",
      );
      const states = await client.query('DELETE FROM conversation_state WHERE expires_at <= now()');
      const mismatches = await reconcileBalances(system, logger);

      const result: MaintenanceResult = {
        ranJobs: true,
        interpretationsDeleted: interpretations.rowCount ?? 0,
        updatesDeleted: updates.rowCount ?? 0,
        draftsExpired: drafts.rowCount ?? 0,
        statesDeleted: states.rowCount ?? 0,
        balanceMismatches: mismatches.length,
      };
      logger.info(result, 'xizmat vazifalari bajarildi');
      return result;
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

/** Soatiga bir marta; xato jarayonni to'xtatmaydi. `stop()` bilan to'xtatiladi. */
export function scheduleMaintenance(
  system: Pool,
  logger: Logger,
  everyMs = 60 * 60 * 1000,
  /** Natija kuzatuvchisi (masalan, qoldiq nomuvofiqligida operatorni ogohlantirish). */
  onResult?: (result: MaintenanceResult) => void,
): () => void {
  const tick = () => {
    runMaintenance(system, logger)
      .then((result) => onResult?.(result))
      .catch((error: unknown) => logger.error({ err: error }, 'xizmat vazifalari xatosi'));
  };
  const timer = setInterval(tick, everyMs);
  timer.unref();
  setTimeout(tick, 30_000).unref(); // ishga tushgandan keyin birinchi yurish
  return () => clearInterval(timer);
}
