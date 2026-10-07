import type { Pool } from 'pg';
import { withTenant } from '../../db/tenant.js';

/** Private chatda foydalanuvchi bo'yicha bitta faol suhbat holati (ADR-0004 §12). Moliyaviy haqiqat emas. */
export interface ConversationState {
  readonly state: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export const STATE_TTL_MINUTES = 15;

export async function getState(pool: Pool, userId: string): Promise<ConversationState | undefined> {
  const { rows } = await withTenant(pool, { userId }, (c) =>
    c.query<{ state: string; data: Record<string, unknown> }>(
      'SELECT state, data FROM conversation_state WHERE user_id = $1 AND expires_at > now()',
      [userId],
    ),
  );
  return rows[0];
}

export async function setState(
  pool: Pool,
  userId: string,
  state: string,
  data: Record<string, unknown> = {},
  ttlMinutes = STATE_TTL_MINUTES,
): Promise<void> {
  await withTenant(pool, { userId }, (c) =>
    c.query(
      `INSERT INTO conversation_state (user_id, state, data, expires_at)
       VALUES ($1, $2, $3::jsonb, now() + make_interval(mins => $4))
       ON CONFLICT (user_id) DO UPDATE
         SET state = EXCLUDED.state, data = EXCLUDED.data,
             expires_at = EXCLUDED.expires_at, updated_at = now()`,
      [userId, state, JSON.stringify(data), ttlMinutes],
    ),
  );
}

export async function clearState(pool: Pool, userId: string): Promise<void> {
  await withTenant(pool, { userId }, (c) =>
    c.query('DELETE FROM conversation_state WHERE user_id = $1', [userId]),
  );
}
