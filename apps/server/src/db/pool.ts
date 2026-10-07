import { Pool, type PoolClient } from 'pg';

export interface PoolOptions {
  readonly max?: number;
  readonly applicationName?: string;
  readonly statementTimeoutMs?: number;
  /** Idle client xatolari (masalan, DB qayta ishga tushganda). Berilmasa jarayon yiqilmaydi, xato yutiladi. */
  readonly onError?: (error: Error) => void;
}

export function createPool(connectionString: string, options: PoolOptions = {}): Pool {
  const pool = new Pool({
    connectionString,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'nasiya-server',
    statement_timeout: options.statementTimeoutMs ?? 10_000,
    idle_in_transaction_session_timeout: 15_000,
    connectionTimeoutMillis: 5_000,
  });
  // Handlersiz 'error' hodisasi Node jarayonini yiqitadi.
  pool.on('error', (error) => options.onError?.(error));
  return pool;
}

export type Queryable = Pick<Pool, 'query'>;

/**
 * Bitta tranzaksiya: muvaffaqiyatda COMMIT, istisnoda ROLLBACK (ADR-0002, TT §27).
 * `fn` ichida faqat berilgan client ishlatilishi shart.
 */
export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
