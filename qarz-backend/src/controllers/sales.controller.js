import { z } from 'zod';
import { asyncHandler } from '../utils/errors.js';
import { query } from '../db/pool.js';

export const salesSchemas = {
  upsert: z.object({
    saleDate: z.string().optional(), // YYYY-MM-DD, defaults today
    cashCard: z.number().nonnegative(),
  }),
  range: z.object({
    from: z.string().optional(),
    to: z.string().optional(),
  }),
};

/**
 * Owner enters cash/card sales for a day. debt_given is auto-maintained
 * by the debt service; here we set cash_card and recompute total.
 */
export const upsertDailySales = asyncHandler(async (req, res) => {
  const shopId = req.user.shopId;
  const saleDate = req.body.saleDate || new Date().toISOString().slice(0, 10);
  const { rows } = await query(
    `INSERT INTO daily_sales (shop_id, sale_date, cash_card, debt_given, total)
     VALUES ($1, $2, $3, 0, $3)
     ON CONFLICT (shop_id, sale_date)
     DO UPDATE SET cash_card = EXCLUDED.cash_card,
                   total = EXCLUDED.cash_card + daily_sales.debt_given,
                   updated_at = now()
     RETURNING *`,
    [shopId, saleDate, req.body.cashCard]
  );
  res.json(rows[0]);
});

/**
 * Sales dynamics for a date range (for the dashboard chart).
 */
export const salesRange = asyncHandler(async (req, res) => {
  const shopId = req.user.shopId;
  const from = req.query.from || null;
  const to = req.query.to || null;
  const { rows } = await query(
    `SELECT sale_date, cash_card, debt_given, total
     FROM daily_sales
     WHERE shop_id = $1
       AND ($2::date IS NULL OR sale_date >= $2)
       AND ($3::date IS NULL OR sale_date <= $3)
     ORDER BY sale_date ASC`,
    [shopId, from, to]
  );
  res.json(rows);
});

/**
 * Dashboard summary: total outstanding, overdue count, this-month turnover.
 */
export const dashboard = asyncHandler(async (req, res) => {
  const shopId = req.user.shopId;

  const outstanding = await query(
    `SELECT COALESCE(SUM(amount - paid_amount),0) AS total
     FROM debts WHERE shop_id = $1 AND status <> 'paid'`,
    [shopId]
  );

  const overdue = await query(
    `SELECT COUNT(*) AS cnt, COALESCE(SUM(amount - paid_amount),0) AS total
     FROM debts WHERE shop_id = $1 AND status = 'overdue'`,
    [shopId]
  );

  const monthly = await query(
    `SELECT COALESCE(SUM(total),0) AS turnover
     FROM daily_sales
     WHERE shop_id = $1 AND date_trunc('month', sale_date) = date_trunc('month', CURRENT_DATE)`,
    [shopId]
  );

  const smsBalance = await query(
    `SELECT remaining, extra_package, monthly_limit FROM sms_balance WHERE shop_id = $1`,
    [shopId]
  );

  // Trial/subscription state so the UI can warn before write access is lost
  const subRow = await query(
    `SELECT plan, status, ends_at FROM subscriptions
     WHERE shop_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [shopId]
  );
  const sub = subRow.rows[0] || null;
  let subscription = null;
  if (sub) {
    const endsAt = new Date(sub.ends_at);
    const msLeft = endsAt.getTime() - Date.now();
    // Round up: a subscription ending in 2 hours still counts as "1 day left"
    const daysLeft = Math.max(0, Math.ceil(msLeft / 86400000));
    const expired = msLeft <= 0 || sub.status === 'expired' || sub.status === 'blocked';
    subscription = {
      plan: sub.plan,
      status: expired ? 'expired' : sub.status,
      endsAt: sub.ends_at,
      trialEndsAt: sub.status === 'trial' ? sub.ends_at : null,
      daysLeft: expired ? 0 : daysLeft,
      isTrial: sub.status === 'trial',
      canWrite: !expired,
    };
  }

  res.json({
    totalOutstanding: Number(outstanding.rows[0].total),
    overdueCount: Number(overdue.rows[0].cnt),
    overdueTotal: Number(overdue.rows[0].total),
    monthlyTurnover: Number(monthly.rows[0].turnover),
    sms: smsBalance.rows[0] || null,
    subscription,
  });
});
