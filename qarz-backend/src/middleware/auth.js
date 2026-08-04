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

    // Load fresh user to enforce is_active and current role, and resolve the
    // shop they act within in the same round trip — an owner's own shop, or a
    // staff member's parent. This previously cost two sequential queries on
    // every single authenticated request.
    const { rows } = await query(
      `SELECT u.id, u.role, u.is_active, u.full_name, u.parent_shop_id, s.id AS owned_shop_id
       FROM users u
       LEFT JOIN shops s ON s.owner_id = u.id
       WHERE u.id = $1
       LIMIT 1`,
      [payload.sub]
    );
    const user = rows[0];
    if (!user || !user.is_active) throw Unauthorized('Foydalanuvchi faol emas');

    let shopId = null;
    if (user.role === 'shop_owner') shopId = user.owned_shop_id || null;
    else if (user.role === 'staff') shopId = user.parent_shop_id;

    req.user = { id: user.id, role: user.role, shopId, fullName: user.full_name };
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
