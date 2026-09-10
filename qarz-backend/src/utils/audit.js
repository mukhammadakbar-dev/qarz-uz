import { query } from '../db/pool.js';

/**
 * Append an entry to audit_logs.
 *
 * Lived as a private helper inside admin.controller.js, which meant only Super
 * Admin actions were ever recorded. Destructive actions taken by shop staff —
 * deleting a debt, say — left no trace at all, so an owner had no way to learn
 * that a record had ever existed.
 *
 * Deliberately not awaited by every caller: an audit write must never be the
 * reason a legitimate action fails. Callers that care about ordering can await
 * it; failures are logged and swallowed.
 */
export const logAction = async (actorId, action, meta) => {
  try {
    await query('INSERT INTO audit_logs (actor_id, action, meta) VALUES ($1,$2,$3)', [
      actorId,
      action,
      meta ? JSON.stringify(meta) : null,
    ]);
  } catch (err) {
    console.error(`[audit] failed to record ${action}:`, err.message);
  }
};
