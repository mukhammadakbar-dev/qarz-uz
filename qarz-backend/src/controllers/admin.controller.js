import { z } from 'zod';
import { asyncHandler, NotFound } from '../utils/errors.js';
import { query, withTransaction } from '../db/pool.js';
import { sendTelegramMessage } from '../services/telegram.service.js';
import { sendSms } from '../services/sms.service.js';

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
  // Route params reach typed columns directly (sub_plan enum, uuid), so
  // validate their shape here rather than letting the driver raise a data-type
  // error deep in the query.
  planCodeParam: z.object({ code: z.enum(['start', 'pro', 'business']) }),
  shopIdParam: z.object({ shopId: z.string().uuid() }),
  broadcast: z.object({
    message: z.string().min(1, 'Xabar bo\'sh bo\'lmasligi kerak').max(1000, 'Xabar juda uzun'),
  }),
  extendSubscription: z.object({
    // Omitted = keep whatever plan the shop is already on, so a plain renewal
    // does not have to restate it and cannot silently change it by accident.
    plan: z.enum(['start', 'pro', 'business']).optional(),
    months: z.number().int().min(1, 'Kamida 1 oy').max(24, 'Ko\'pi bilan 24 oy'),
    // 0 is valid: a comped extension is still a real event to record.
    amountUzs: z.number().nonnegative('Summa manfiy bo\'lmasligi kerak'),
    note: z.string().max(500).optional(),
  }),
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
  // Independent aggregates: run them concurrently rather than paying a
  // sequential round-trip each on a page the admin dashboard polls.
  const [shops, activeSubs, smsUsed, revenue, collected] = await Promise.all([
    query('SELECT COUNT(*) AS c FROM shops'),
    query(
      `SELECT COUNT(*) AS c FROM subscriptions WHERE status IN ('active','trial') AND ends_at > now()`
    ),
    query(
      `SELECT COUNT(*) AS c FROM notifications WHERE channel = 'sms' AND status = 'sent'
       AND created_at >= date_trunc('month', CURRENT_DATE)`
    ),
    query(
      `SELECT COALESCE(SUM(p.price_uzs),0) AS total
       FROM subscriptions sub JOIN plans p ON p.code = sub.plan
       WHERE sub.status = 'active'`
    ),
    // Money actually received this month. Distinct from the MRR figure above,
    // which is what active subscriptions are nominally worth — the two diverge
    // whenever a shop pays for several months at once, or is comped.
    query(
      `SELECT COALESCE(SUM(amount_uzs),0) AS total
       FROM subscription_payments
       WHERE created_at >= date_trunc('month', CURRENT_DATE)`
    ),
  ]);
  res.json({
    totalShops: Number(shops.rows[0].c),
    activeSubscriptions: Number(activeSubs.rows[0].c),
    smsThisMonth: Number(smsUsed.rows[0].c),
    monthlyRecurringRevenue: Number(revenue.rows[0].total),
    collectedThisMonth: Number(collected.rows[0].total),
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

  // An unknown shop id matched nothing and still answered {ok:true, updated:0},
  // so a typo in the admin panel looked like a successful block.
  const shop = await query('SELECT id FROM shops WHERE id = $1', [req.params.shopId]);
  if (!shop.rows[0]) throw NotFound('Do\'kon topilmadi');

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

/**
 * POST /api/admin/broadcast — send a system announcement to every active
 * shop owner (TZ 4.6 item 9: "Xabarnoma/E'lon yuborish").
 *
 * Uses the same channel-selection rule as debtor reminders: Telegram if the
 * owner has linked an account, SMS otherwise. This is a platform-wide notice
 * to shop owners, not tied to any single shop's SMS balance/quota, so it does
 * not touch `sms_balance` — that table tracks per-shop debtor-reminder spend.
 */
export const broadcast = asyncHandler(async (req, res) => {
  const { message } = req.body;

  const { rows: owners } = await query(
    `SELECT id, phone, telegram_id, full_name FROM users
     WHERE role = 'shop_owner' AND is_active = TRUE`
  );

  let telegramSent = 0;
  let smsSent = 0;
  let failed = 0;

  const text = `📢 TemirDaftar.uz: ${message}`;

  const deliver = async (owner) => {
    let result;
    if (owner.telegram_id) {
      result = await sendTelegramMessage(owner.telegram_id, text);
      if (result.ok) telegramSent++;
    } else if (owner.phone) {
      result = await sendSms(owner.phone, text);
      if (result.ok) smsSent++;
    } else {
      result = { ok: false, error: 'no contact channel' };
    }
    if (!result.ok) failed++;
  };

  // Sending strictly one-at-a-time meant the request stayed open for
  // owners x round-trip — minutes once the platform has a few hundred shops,
  // which no gateway will hold. A bounded pool keeps wall time proportional to
  // owners/CONCURRENCY while staying polite to Telegram and Eskiz.
  const CONCURRENCY = 8;
  const queue = [...owners];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      let owner;
      while ((owner = queue.shift()) !== undefined) {
        await deliver(owner);
      }
    })
  );

  await logAction(req.user.id, 'broadcast', {
    message,
    totalOwners: owners.length,
    telegramSent,
    smsSent,
    failed,
  });

  res.json({
    ok: true,
    totalOwners: owners.length,
    telegramSent,
    smsSent,
    failed,
  });
});

/**
 * PATCH /api/admin/shops/:shopId/subscription
 *
 * Activate or extend a shop's subscription by hand, and record what was paid.
 * This is how subscriptions work until Click is integrated: the owner messages
 * the admin, pays, and the admin extends the period here.
 *
 * Deliberately separate from setShopActive: that toggles users.is_active, which
 * is the moderation lever (block an abusive shop). A paid-up shop can still be
 * blocked, and a blocked shop's subscription can still be extended. Conflating
 * them would mean unblocking someone silently gave them free time.
 */
export const extendSubscription = asyncHandler(async (req, res) => {
  const { shopId } = req.params;
  const { months, amountUzs, note } = req.body;

  const result = await withTransaction(async (client) => {
    const shop = await client.query('SELECT id, name FROM shops WHERE id = $1', [shopId]);
    if (!shop.rows[0]) throw NotFound('Do\'kon topilmadi');

    // Lock the row: two admins extending the same shop at once would otherwise
    // both read the same ends_at and the second would overwrite the first,
    // granting one period for two payments.
    const current = await client.query(
      `SELECT id, plan, ends_at FROM subscriptions
       WHERE shop_id = $1 ORDER BY created_at DESC LIMIT 1
       FOR UPDATE`,
      [shopId]
    );
    const sub = current.rows[0];
    const oldPlan = sub?.plan || 'start';
    const plan = req.body.plan || oldPlan;

    // Extend from whichever is later: now, or the existing expiry. Paying
    // early is common and must not forfeit the days already paid for, while an
    // account that lapsed three months ago must not be credited for that gap.
    const now = new Date();
    const base = sub && new Date(sub.ends_at) > now ? new Date(sub.ends_at) : now;
    const endsAt = new Date(base);
    // setMonth handles month lengths and year rollover; adding 30-day chunks
    // would drift a renewal date backwards over a year.
    endsAt.setMonth(endsAt.getMonth() + months);

    if (sub) {
      await client.query(
        `UPDATE subscriptions
         SET plan = $2, status = 'active', ends_at = $3, updated_at = now()
         WHERE id = $1`,
        [sub.id, plan, endsAt]
      );
    } else {
      // A shop with no subscription row at all is treated as expired by
      // enforceSubscription, so create one rather than leaving it stuck.
      await client.query(
        `INSERT INTO subscriptions (shop_id, plan, status, starts_at, ends_at)
         VALUES ($1, $2, 'active', now(), $3)`,
        [shopId, plan, endsAt]
      );
    }

    // The SMS quota lives on sms_balance and is what the monthly reset copies
    // from, so a plan change that skipped it would leave an upgraded shop on
    // the old allowance until someone noticed.
    if (plan !== oldPlan) {
      const planRow = await client.query('SELECT monthly_sms FROM plans WHERE code = $1', [plan]);
      const newLimit = planRow.rows[0]?.monthly_sms;
      if (newLimit !== undefined) {
        // Credit an upgrade immediately — a shop that pays for Pro today
        // expects the bigger allowance today, not after the next reset. A
        // downgrade only lowers the limit for future resets; clawing back
        // messages already granted would be a surprise mid-month.
        await client.query(
          `UPDATE sms_balance
           SET remaining = remaining + GREATEST($2 - monthly_limit, 0),
               monthly_limit = $2,
               updated_at = now()
           WHERE shop_id = $1`,
          [shopId, newLimit]
        );
      }
    }

    const payment = await client.query(
      `INSERT INTO subscription_payments
         (shop_id, amount_uzs, method, plan, months, period_start, period_end, note, recorded_by)
       VALUES ($1, $2, 'manual', $3, $4, $5, $6, $7, $8)
       RETURNING id, amount_uzs, plan, months, period_start, period_end, created_at`,
      [shopId, amountUzs, plan, months, base, endsAt, note || null, req.user.id]
    );

    return { shopName: shop.rows[0].name, plan, endsAt, payment: payment.rows[0] };
  });

  await logAction(req.user.id, 'extend_subscription', {
    shopId,
    plan: result.plan,
    months,
    amountUzs,
    endsAt: result.endsAt,
    note: note || null,
  });

  res.json({
    ok: true,
    shopName: result.shopName,
    plan: result.plan,
    endsAt: result.endsAt,
    payment: result.payment,
  });
});

/**
 * GET /api/admin/shops/:shopId/subscription-payments
 * Payment history for one shop, newest first.
 */
export const listSubscriptionPayments = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT sp.id, sp.amount_uzs, sp.method, sp.plan, sp.months,
            sp.period_start, sp.period_end, sp.note, sp.created_at,
            u.phone AS recorded_by_phone
     FROM subscription_payments sp
     LEFT JOIN users u ON u.id = sp.recorded_by
     WHERE sp.shop_id = $1
     ORDER BY sp.created_at DESC
     LIMIT 100`,
    [req.params.shopId]
  );
  res.json(rows);
});
