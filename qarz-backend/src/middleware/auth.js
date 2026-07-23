import { verifyAccessToken } from '../utils/tokens.js';
import { Unauthorized, Forbidden } from '../utils/errors.js';
import { query } from '../db/pool.js';

/**
 * Requires a valid access token. Attaches req.user = { id, role, shopId }.
 */
export const authenticate = async (req, _res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw Unauthorized('Token yo\'q');

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      throw Unauthorized('Token yaroqsiz yoki muddati o\'tgan');
    }

    // load fresh user to enforce is_active and current role
    const { rows } = await query(
      'SELECT id, role, is_active, parent_shop_id FROM users WHERE id = $1',
      [payload.sub]
    );
    const user = rows[0];
    if (!user || !user.is_active) throw Unauthorized('Foydalanuvchi faol emas');

    // resolve the shop this user acts within (owner's own shop, or staff's parent)
    let shopId = null;
    if (user.role === 'shop_owner') {
      const s = await query('SELECT id FROM shops WHERE owner_id = $1 LIMIT 1', [user.id]);
      shopId = s.rows[0]?.id || null;
    } else if (user.role === 'staff') {
      shopId = user.parent_shop_id;
    }

    req.user = { id: user.id, role: user.role, shopId };
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Restrict a route to specific roles.
 * Usage: authorize('super_admin'), authorize('shop_owner', 'staff')
 */
export const authorize = (...roles) => (req, _res, next) => {
  if (!req.user) return next(Unauthorized());
  if (!roles.includes(req.user.role)) return next(Forbidden());
  next();
};
