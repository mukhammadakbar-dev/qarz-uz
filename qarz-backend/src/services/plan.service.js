import { query } from '../db/pool.js';
import { AppError } from '../utils/errors.js';

/**
 * Resolve the effective plan limits for a shop from its newest subscription.
 * Returns null when the shop has no plan row (treated as unlimited by callers
 * that choose to, but both current callers fail closed on missing shopId).
 */
export const getShopPlan = async (shopId) => {
  const { rows } = await query(
    `SELECT p.code, p.name, p.max_debtors, p.max_staff, p.monthly_sms, p.advanced_stats
     FROM subscriptions s
     JOIN plans p ON p.code = s.plan
     WHERE s.shop_id = $1
     ORDER BY s.created_at DESC
     LIMIT 1`,
    [shopId]
  );
  return rows[0] || null;
};

/**
 * Throw 422 PLAN_LIMIT_REACHED if adding one more debtor would exceed the plan.
 * A NULL max_debtors means unlimited.
 */
export const assertDebtorQuota = async (shopId) => {
  if (!shopId) return;
  const plan = await getShopPlan(shopId);
  if (!plan || plan.max_debtors == null) return;

  const { rows } = await query(
    'SELECT COUNT(*)::int AS c FROM debtors WHERE shop_id = $1',
    [shopId]
  );
  const current = rows[0].c;

  if (current >= plan.max_debtors) {
    throw new AppError(
      `"${plan.name}" tarifida mijozlar limiti (${plan.max_debtors} ta) to'ldi. Tarifni yangilang.`,
      422,
      'PLAN_LIMIT_REACHED'
    );
  }
};

/**
 * Throw 422 PLAN_LIMIT_REACHED if adding one more staff member would exceed
 * the plan. A NULL max_staff means unlimited; 0 means staff not included.
 */
export const assertStaffQuota = async (shopId) => {
  if (!shopId) return;
  const plan = await getShopPlan(shopId);
  if (!plan || plan.max_staff == null) return;

  const { rows } = await query(
    `SELECT COUNT(*)::int AS c FROM users
     WHERE parent_shop_id = $1 AND role = 'staff'`,
    [shopId]
  );
  const current = rows[0].c;

  if (current >= plan.max_staff) {
    const msg =
      plan.max_staff === 0
        ? `"${plan.name}" tarifida xodim qo'shish imkoni yo'q. Yuqoriroq tarifga o'ting.`
        : `"${plan.name}" tarifida xodimlar limiti (${plan.max_staff} ta) to'ldi. Tarifni yangilang.`;
    throw new AppError(msg, 422, 'PLAN_LIMIT_REACHED');
  }
};
