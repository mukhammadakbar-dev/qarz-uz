import { z } from 'zod';
import { asyncHandler, NotFound } from '../utils/errors.js';
import { query } from '../db/pool.js';

export const adminSchemas = {
  listShops: z.object({
    search: z.string().optional(),
    plan: z.enum(['start', 'pro', 'business']).optional(),
    status: z.enum(['trial', 'active', 'expired', 'blocked']).optional(),
  }),
  updatePlan: z.object({
    name: z.string().min(1).optional(),
    priceUzs: z.number().nonnegative().optional(),
    // null is meaningful here: unlimited debtors
    maxDebtors: z.number().int().nonnegative().nullable().optional(),
    maxStaff: z.number().int().nonnegative().optional(),
    monthlySms: z.number().int().nonnegative().optional(),
    advancedStats: z.boolean().optional(),
  }),
  setShopActive: z.object({ active: z.boolean() }),
  broadcast: z.object({ message: z.string().min(1) }),
};

const logAction = (actorId, action, meta) =>
  query('INSERT INTO audit_logs (actor_id, action, meta) VALUES ($1,$2,$3)', [
    actorId,
    action,
    meta ? JSON.stringify(meta) : null,
  ]);

export const listShops = asyncHandler(async (req, res) => {
  const { search, plan, status } = req.query;
  const clauses = [];
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    clauses.push(`(s.name ILIKE $${params.length} OR u.phone ILIKE $${params.length})`);
  }
  if (plan) {
    params.push(plan);
    clauses.push(`sub.plan = $${params.length}`);
  }
  if (status) {
    params.push(status);
    clauses.push(`sub.status = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT s.id, s.name, s.created_at,
            u.phone AS owner_phone, u.is_active,
            sub.plan, sub.status, sub.ends_at,
            sb.remaining AS sms_remaining
     FROM shops s
     JOIN users u ON u.id = s.owner_id
     LEFT JOIN LATERAL (
       SELECT plan, status, ends_at FROM subscriptions
       WHERE shop_id = s.id ORDER BY created_at DESC LIMIT 1
     ) sub ON true
     LEFT JOIN sms_balance sb ON sb.shop_id = s.id
     ${where}
     ORDER BY s.created_at DESC`,
    params
  );
  res.json(rows);
});

export const platformStats = asyncHandler(async (_req, res) => {
  const shops = await query('SELECT COUNT(*) AS c FROM shops');
  const activeSubs = await query(
    `SELECT COUNT(*) AS c FROM subscriptions WHERE status IN ('active','trial') AND ends_at > now()`
  );
  const smsUsed = await query(
    `SELECT COUNT(*) AS c FROM notifications WHERE channel = 'sms' AND status = 'sent'
     AND created_at >= date_trunc('month', CURRENT_DATE)`
  );
  const revenue = await query(
    `SELECT COALESCE(SUM(p.price_uzs),0) AS total
     FROM subscriptions sub JOIN plans p ON p.code = sub.plan
     WHERE sub.status = 'active'`
  );
  res.json({
    totalShops: Number(shops.rows[0].c),
    activeSubscriptions: Number(activeSubs.rows[0].c),
    smsThisMonth: Number(smsUsed.rows[0].c),
    monthlyRecurringRevenue: Number(revenue.rows[0].total),
  });
});

export const listPlans = asyncHandler(async (_req, res) => {
  const { rows } = await query('SELECT * FROM plans ORDER BY price_uzs ASC');
  res.json(rows);
});

export const updatePlan = asyncHandler(async (req, res) => {
  const code = req.params.code;
  const b = req.body;
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);

  // Build the SET clause from only the keys actually present in the body, so
  // an explicit `null` (e.g. max_debtors: null = unlimited) is applied rather
  // than being swallowed by COALESCE.
  const map = [
    ['name', 'name'],
    ['priceUzs', 'price_uzs'],
    ['maxDebtors', 'max_debtors'],
    ['maxStaff', 'max_staff'],
    ['monthlySms', 'monthly_sms'],
    ['advancedStats', 'advanced_stats'],
  ];

  const sets = [];
  const params = [code];
  for (const [bodyKey, column] of map) {
    if (has(bodyKey)) {
      params.push(b[bodyKey]);
      sets.push(`${column} = $${params.length}`);
    }
  }

  if (sets.length === 0) {
    const current = await query('SELECT * FROM plans WHERE code = $1', [code]);
    if (!current.rows[0]) throw NotFound('Tarif topilmadi');
    return res.json(current.rows[0]);
  }

  sets.push('updated_at = now()');
  const { rows } = await query(
    `UPDATE plans SET ${sets.join(', ')} WHERE code = $1 RETURNING *`,
    params
  );
  if (!rows[0]) throw NotFound('Tarif topilmadi');

  await logAction(req.user.id, 'update_plan', { code, changes: b });
  res.json(rows[0]);
});

export const setShopActive = asyncHandler(async (req, res) => {
  const { active } = req.body;
  // Block/unblock the owner *and* every staff member of that shop, otherwise
  // staff accounts keep working after the shop is blocked.
  const { rows } = await query(
    `UPDATE users SET is_active = $2, updated_at = now()
     WHERE id = (SELECT owner_id FROM shops WHERE id = $1)
        OR parent_shop_id = $1
     RETURNING id`,
    [req.params.shopId, !!active]
  );
  await logAction(req.user.id, active ? 'activate_shop' : 'block_shop', { shopId: req.params.shopId });
  res.json({ ok: true, updated: rows.length });
});

export const auditLog = asyncHandler(async (_req, res) => {
  const { rows } = await query(
    `SELECT a.*, u.phone AS actor_phone FROM audit_logs a
     LEFT JOIN users u ON u.id = a.actor_id
     ORDER BY a.created_at DESC LIMIT 200`
  );
  res.json(rows);
});
