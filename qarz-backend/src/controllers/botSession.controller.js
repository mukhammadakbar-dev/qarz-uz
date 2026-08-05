import { z } from 'zod';
import { asyncHandler } from '../utils/errors.js';
import { query } from '../db/pool.js';

/**
 * Server-side store for the Telegram bot's per-user sessions.
 *
 * These routes are gated by the bot shared secret (requireBotSecret), NOT by a
 * user token — the bot legitimately reads and writes sessions across all its
 * users. That makes the secret high-value: anyone holding it can read every
 * bot user's tokens, so it must be long, random, and never shared with the
 * browser client.
 */

// Telegram ids are positive and comfortably inside the safe-integer range, but
// arrive as a path string. Coerce, then bound.
const telegramIdParam = z.object({
  telegramId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

const sessionBody = z.object({
  // Opaque to us: whatever shape the bot keeps (tokens, role, phone, lang).
  // Bounded so a bug in the bot cannot write unbounded rows into the database.
  data: z.record(z.any()).refine(
    (d) => JSON.stringify(d).length <= 8192,
    'Sessiya hajmi 8KB dan oshmasligi kerak'
  ),
});

export const schemas = { telegramIdParam, sessionBody };

/**
 * Every session, for the bot to hydrate its in-memory cache at startup.
 * The bot is a single long-polling process holding a bounded number of
 * sessions, so one bulk read is cheaper than a query per update.
 */
export const listSessionsCtrl = asyncHandler(async (_req, res) => {
  const { rows } = await query(
    `SELECT telegram_id, data FROM bot_sessions ORDER BY updated_at DESC`
  );
  // Keys as strings: a BIGINT telegram id can exceed what a JS number holds
  // exactly, and the bot only ever uses it as a map key.
  const sessions = {};
  for (const r of rows) sessions[String(r.telegram_id)] = r.data;
  res.json({ sessions });
});

/** Create or replace one session. The bot always sends the merged, full object. */
export const putSessionCtrl = asyncHandler(async (req, res) => {
  const { telegramId } = req.params;
  const { data } = req.body;
  await query(
    `INSERT INTO bot_sessions (telegram_id, data)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (telegram_id)
     DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [telegramId, JSON.stringify(data)]
  );
  res.json({ ok: true });
});

/** Drop a session — logout, or an unrecoverable refresh failure. */
export const deleteSessionCtrl = asyncHandler(async (req, res) => {
  const { telegramId } = req.params;
  await query(`DELETE FROM bot_sessions WHERE telegram_id = $1`, [telegramId]);
  res.json({ ok: true });
});
