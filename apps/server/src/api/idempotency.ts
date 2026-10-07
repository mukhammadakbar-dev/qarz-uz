import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { withTenant } from '../db/tenant.js';
import { ConflictError, IdempotencyKeyReusedError, ValidationError } from '../errors/index.js';

/**
 * Mini App so'rovlari uchun idempotentlik (ADR-0003 §3). Bir xil (user, kalit, tana) → saqlangan javob;
 * bir xil kalit, boshqa tana → 422. Bajarilayotgan so'rov takrorlansa 409. Xatoga uchragan so'rov saqlanmaydi,
 * shuning uchun qayta urinish mumkin. Pul yozuvlari qo'shimcha ravishda ledger darajasida ham kalit bilan himoyalangan.
 */

const KEY_FORMAT = /^[A-Za-z0-9_.:-]{8,80}$/;
const STALE_SECONDS = 30;

export interface ApiResult {
  readonly status: number;
  readonly body: unknown;
}

export interface IdempotentOutcome extends ApiResult {
  readonly replayed: boolean;
}

export function readKey(request: FastifyRequest): string {
  const raw = request.headers['idempotency-key'];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (typeof key !== 'string' || !KEY_FORMAT.test(key)) {
    throw new ValidationError('Idempotency-Key sarlavhasi majburiy (8-80 belgi)', {
      details: { reason: 'IDEMPOTENCY_KEY_REQUIRED' },
    });
  }
  return key;
}

const hashOf = (request: FastifyRequest): string =>
  createHash('sha256')
    .update(`${request.method}\n${request.raw.url ?? ''}\n${JSON.stringify(request.body ?? null)}`)
    .digest('hex');

export async function runIdempotent(
  pool: Pool,
  request: FastifyRequest,
  userId: string,
  execute: (key: string) => Promise<ApiResult>,
): Promise<IdempotentOutcome> {
  const key = readKey(request);
  const hash = hashOf(request);
  const db = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(pool, { userId }, fn);

  const claimed = await db((c) =>
    c.query(
      'INSERT INTO idempotency_keys (user_id, key, request_hash) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [userId, key, hash],
    ),
  );

  if (claimed.rowCount === 0) {
    const { rows } = await db((c) =>
      c.query<{
        request_hash: string;
        state: 'IN_PROGRESS' | 'DONE';
        status_code: number | null;
        response: unknown;
        stale: boolean;
      }>(
        `SELECT request_hash, state, status_code, response,
                created_at < now() - make_interval(secs => $3) AS stale
           FROM idempotency_keys WHERE user_id = $1 AND key = $2`,
        [userId, key, STALE_SECONDS],
      ),
    );
    const row = rows[0];
    if (row) {
      if (row.request_hash !== hash) throw new IdempotencyKeyReusedError();
      if (row.state === 'DONE')
        return { status: row.status_code ?? 200, body: row.response, replayed: true };
      if (!row.stale) {
        throw new ConflictError('So‘rov hozir bajarilmoqda', {
          details: { reason: 'IN_PROGRESS' },
        });
      }
      // Eski, tugallanmagan urinish (jarayon uzilgan): egalikni olamiz
      const took = await db((c) =>
        c.query(
          "UPDATE idempotency_keys SET created_at = now() WHERE user_id = $1 AND key = $2 AND state = 'IN_PROGRESS' AND created_at < now() - make_interval(secs => $3)",
          [userId, key, STALE_SECONDS],
        ),
      );
      if (took.rowCount === 0) {
        throw new ConflictError('So‘rov hozir bajarilmoqda', {
          details: { reason: 'IN_PROGRESS' },
        });
      }
    }
  }

  try {
    const result = await execute(`api:${userId}:${key}`);
    await db((c) =>
      c.query(
        "UPDATE idempotency_keys SET state = 'DONE', status_code = $3, response = $4::jsonb WHERE user_id = $1 AND key = $2",
        [userId, key, result.status, JSON.stringify(result.body ?? null)],
      ),
    );
    return { ...result, replayed: false };
  } catch (error) {
    // Muvaffaqiyatsiz so'rov saqlanmaydi: foydalanuvchi qayta urina oladi
    await db((c) =>
      c.query('DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2', [userId, key]),
    ).catch(() => undefined);
    throw error;
  }
}
