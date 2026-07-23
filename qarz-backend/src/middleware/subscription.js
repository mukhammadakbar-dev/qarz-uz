import { query } from '../db/pool.js';
import { AppError } from '../utils/errors.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Blocks write operations for shops whose trial/subscription has lapsed.
 * Reads (GET/HEAD) stay allowed so an expired shop keeps "view-only" access
 * to its own records instead of being locked out of its data.
 *
 * Runs after `authenticate`; no-ops for roles without a shop.
 */
export const enforceSubscription = async (req, _res, next) => {
  try {
    const user = req.user;
    if (!user) return next();
    if (user.role !== 'shop_owner' && user.role !== 'staff') return next();
    if (!WRITE_METHODS.has(req.method)) return next();
    if (!user.shopId) return next();

    const { rows } = await query(
      `SELECT status, ends_at FROM subscriptions
       WHERE shop_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [user.shopId]
    );
    const sub = rows[0];

    // no subscription row at all -> treat as expired
    const expired =
      !sub ||
      sub.status === 'expired' ||
      sub.status === 'blocked' ||
      new Date(sub.ends_at) < new Date();

    if (expired) {
      throw new AppError(
        'Obuna muddati tugagan. Yozish uchun tarifni yangilang.',
        403,
        'SUBSCRIPTION_EXPIRED'
      );
    }

    next();
  } catch (err) {
    next(err);
  }
};
