import { z } from 'zod';
import { logAction } from '../utils/audit.js';
import { asyncHandler, NotFound } from '../utils/errors.js';
import { query, withTransaction } from '../db/pool.js';
import { sendTelegramMessage } from '../services/telegram.service.js';

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
    target: z
      .enum([
        'all',
        'telegram_all',
        'active',
        'trial',
        'expired',
        'blocked',
        'plan_start',
        'plan_pro',
        'plan_business',
      ])
      .optional()
      .default('all'),
  }),
  extendSubscription: z.object({
    plan: z.enum(['start', 'pro', 'business']).optional(),
    months: z.number().int().min(1, 'Kamida 1 oy').max(24, 'Ko\'pi bilan 24 oy'),
    amountUzs: z.number().nonnegative('Summa manfiy bo\'lmasligi kerak'),
    note: z.string().max(500).optional(),
  }),
  addSmsQuota: z.object({
    amount: z.number().int().positive('SMS soni musbat bo\'lishi kerak'),
  }),
};

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
            sb.remaining AS sms_remaining,
            COALESCE(debt_stats.debtor_count, 0) AS debtor_count,
            COALESCE(debt_stats.total_outstanding, 0) AS total_outstanding
     FROM shops s
     JOIN users u ON u.id = s.owner_id
     LEFT JOIN LATERAL (
       SELECT plan, status, ends_at FROM subscriptions
       WHERE shop_id = s.id ORDER BY created_at DESC LIMIT 1
     ) sub ON true
     LEFT JOIN sms_balance sb ON sb.shop_id = s.id
     LEFT JOIN LATERAL (
       SELECT COUNT(DISTINCT d.id) AS debtor_count,
              SUM(db.amount - db.paid_amount) AS total_outstanding
       FROM debtors d
       LEFT JOIN debts db ON db.debtor_id = d.id AND db.status != 'paid'
       WHERE d.shop_id = s.id AND d.is_archived = FALSE
     ) debt_stats ON true
     ${where}
     ORDER BY s.created_at DESC`,
    params
  );
  res.json(rows);
});

export const platformStats = asyncHandler(async (_req, res) => {
  const [shops, activeSubs, smsUsed, collected, platformDebts, platformDebtors, telegramUsers] = await Promise.all([
    query('SELECT COUNT(*) AS c FROM shops').catch(() => ({ rows: [{ c: 0 }] })),
    query(
      `SELECT COUNT(*) AS c FROM subscriptions WHERE status IN ('active','trial') AND ends_at > now()`
    ).catch(() => ({ rows: [{ c: 0 }] })),
    query(
      `SELECT COUNT(*) AS c FROM notifications WHERE channel = 'sms' AND status = 'sent'
       AND created_at >= date_trunc('month', CURRENT_DATE)`
    ).catch(() => ({ rows: [{ c: 0 }] })),
    query(
      `SELECT COALESCE(SUM(amount_uzs),0) AS total
       FROM subscription_payments
       WHERE created_at >= date_trunc('month', CURRENT_DATE)`
    ).catch(() => ({ rows: [{ total: 0 }] })),
    query(
      `SELECT COALESCE(SUM(amount - paid_amount), 0) AS total FROM debts WHERE status != 'paid'`
    ).catch(() => ({ rows: [{ total: 0 }] })),
    query(
      `SELECT COUNT(*) AS c FROM debtors WHERE is_archived = FALSE`
    ).catch(() => ({ rows: [{ c: 0 }] })),
    query(
      `SELECT COUNT(DISTINCT telegram_id) AS c FROM (
         SELECT telegram_id FROM users WHERE telegram_id IS NOT NULL AND is_active = TRUE
         UNION
         SELECT telegram_id FROM bot_sessions WHERE telegram_id IS NOT NULL
         UNION
         SELECT telegram_id FROM debtors WHERE telegram_id IS NOT NULL AND is_archived = FALSE
       ) tg_users WHERE telegram_id IS NOT NULL`
    ).catch(() => ({ rows: [{ c: 0 }] }))
  ]);
  res.json({
    totalShops: Number(shops.rows[0]?.c || 0),
    activeSubscriptions: Number(activeSubs.rows[0]?.c || 0),
    smsThisMonth: Number(smsUsed.rows[0]?.c || 0),
    collectedThisMonth: Number(collected.rows[0]?.total || 0),
    totalPlatformDebt: Number(platformDebts.rows[0]?.total || 0),
    totalDebtors: Number(platformDebtors.rows[0]?.c || 0),
    totalTelegramUsers: Number(telegramUsers.rows[0]?.c || 0),
  });
});

export const addSmsQuota = asyncHandler(async (req, res) => {
  const { shopId } = req.params;
  const { amount } = req.body;

  const shop = await query('SELECT id, name FROM shops WHERE id = $1', [shopId]);
  if (!shop.rows[0]) throw NotFound('Do\'kon topilmadi');

  const { rows } = await query(
    `INSERT INTO sms_balance (shop_id, remaining, extra_package, monthly_limit)
     VALUES ($1, $2, $2, 0)
     ON CONFLICT (shop_id) DO UPDATE
     SET remaining = sms_balance.remaining + $2,
         extra_package = sms_balance.extra_package + $2,
         updated_at = now()
     RETURNING *`,
    [shopId, amount]
  );

  await logAction(req.user.id, 'add_sms_quota', { shopId, amount });
  res.json({ ok: true, shopName: shop.rows[0].name, sms: rows[0] });
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
 * Delivery is store-then-push. The announcement is written to `announcements`
 * first, which is what makes the web app a reliable channel: every active owner
 * sees it next time they sign in, for free, and it is still there weeks later.
 * Telegram is then a best-effort push on top, for owners who linked an account.
 *
 * SMS was deliberately dropped. It was the fallback for owners without Telegram
 * — which, in practice, was all of them — so every announcement went out as paid
 * messages, and vanished the moment they were read. The stored copy covers that
 * case better and costs nothing.
 *
 * Nothing here touches `sms_balance`: that tracks per-shop debtor-reminder spend,
 * and a platform notice is not the shop's expense.
 */
export const broadcast = asyncHandler(async (req, res) => {
  const { message, target = 'all' } = req.body;

  let owners = [];
  if (target === 'telegram_all') {
    const { rows: tgRows } = await query(
      `SELECT DISTINCT telegram_id FROM (
         SELECT telegram_id FROM users WHERE telegram_id IS NOT NULL AND is_active = TRUE
         UNION
         SELECT telegram_id FROM bot_sessions WHERE telegram_id IS NOT NULL
         UNION
         SELECT telegram_id FROM debtors WHERE telegram_id IS NOT NULL AND is_archived = FALSE
       ) tg_users WHERE telegram_id IS NOT NULL`
    );
    owners = tgRows.map((r) => ({ id: null, telegram_id: r.telegram_id }));
  } else {
    let queryText = `
      SELECT u.id, u.telegram_id, u.is_active, sub.plan, sub.status, sub.ends_at
      FROM users u
      LEFT JOIN shops s ON s.owner_id = u.id
      LEFT JOIN subscriptions sub ON sub.shop_id = s.id
      WHERE u.role = 'shop_owner'
    `;

    const params = [];

    if (target === 'all') {
      queryText += ` AND u.is_active = TRUE`;
    } else if (target === 'active') {
      queryText += ` AND u.is_active = TRUE AND sub.status = 'active' AND sub.ends_at > now()`;
    } else if (target === 'trial') {
      queryText += ` AND u.is_active = TRUE AND sub.status = 'trial' AND sub.ends_at > now()`;
    } else if (target === 'expired') {
      queryText += ` AND u.is_active = TRUE AND (sub.ends_at <= now() OR sub.status = 'expired')`;
    } else if (target === 'blocked') {
      queryText += ` AND (u.is_active = FALSE OR sub.status = 'blocked')`;
    } else if (target.startsWith('plan_')) {
      const planCode = target.replace('plan_', '');
      params.push(planCode);
      queryText += ` AND u.is_active = TRUE AND sub.plan = $${params.length}`;
    }

    const resDb = await query(queryText, params);
    owners = resDb.rows;
  }

  // Stored first and unconditionally: if the Telegram push below fails for
  // everyone, the announcement still reached every owner's web app.
  const { rows: saved } = await query(
    `INSERT INTO announcements (body, target_type, created_by) VALUES ($1, $2, $3) RETURNING id`,
    [message, target, req.user.id]
  );
  const announcementId = saved[0].id;

  let telegramSent = 0;
  let failed = 0;

  const text = `📢 <b>TemirDaftar</b>: ${message}`;

  const deliver = async (owner) => {
    // No Telegram is not a failure any more — the owner has the announcement
    // waiting in the app.
    if (!owner.telegram_id) return;
    const result = await sendTelegramMessage(owner.telegram_id, text);
    if (result.ok) telegramSent++;
    else failed++;
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
    announcementId,
    message,
    target,
    totalOwners: owners.length,
    telegramSent,
    failed,
  });

  res.json({
    ok: true,
    announcementId,
    target,
    // Everyone in the target group got the stored copy; Telegram counts describe the push only.
    totalOwners: owners.length,
    telegramSent,
    failed,
  });
});

/**
 * Add whole months to a date, clamping to the end of the target month.
 *
 * `setMonth` alone does NOT handle month lengths: Jan 31 + 1 month rolls over
 * into "Feb 31", which JS silently normalises to Mar 3, and Aug 31 + 6 months
 * lands on Mar 3 instead of the end of February. That is free time on every
 * month-end renewal, and it is written into the payment record's period_end as
 * well. Clamping matches what Postgres' `interval '1 month'` would have done.
 */
export const addMonths = (date, months) => {
  const d = new Date(date);
  const day = d.getDate();
  // Move to the 1st first, so the month arithmetic cannot overflow on its own.
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  // Day 0 of the following month is the last day of this one.
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
};

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
    // Lock the SHOP row, not just the subscription. A shop that has no
    // subscription row yet locks nothing with `FOR UPDATE` below — the lock
    // covers rows that exist — so two admins extending such a shop at the same
    // moment would each see "no subscription" and each INSERT one. Taking the
    // lock here serialises both paths on something that always exists.
    const shop = await client.query(
      'SELECT id, name FROM shops WHERE id = $1 FOR UPDATE',
      [shopId]
    );
    if (!shop.rows[0]) throw NotFound('Do\'kon topilmadi');

    // Lock the row: two admins extending the same shop at once would otherwise
    // both read the same ends_at and the second would overwrite the first,
    // granting one period for two payments.
    const current = await client.query(
      `SELECT id, plan, status, ends_at FROM subscriptions
       WHERE shop_id = $1 ORDER BY created_at DESC LIMIT 1
       FOR UPDATE`,
      [shopId]
    );
    const sub = current.rows[0];
    const oldPlan = sub?.plan || 'start';
    const plan = req.body.plan || oldPlan;

    // 'blocked' is a moderation decision, not an expiry, and it is read as such
    // by enforceSubscription and the dashboard. Forcing 'active' here would let
    // a routine renewal quietly lift a block nobody meant to lift — the same
    // reason retireLapsedSubscriptions leaves 'blocked' alone. Take the money,
    // extend the period, leave the moderation state to the moderation lever.
    const status = sub?.status === 'blocked' ? 'blocked' : 'active';

    // Extend from whichever is later: now, or the existing expiry. Paying
    // early is common and must not forfeit the days already paid for, while an
    // account that lapsed three months ago must not be credited for that gap.
    const now = new Date();
    const base = sub && new Date(sub.ends_at) > now ? new Date(sub.ends_at) : now;
    const endsAt = addMonths(base, months);

    if (sub) {
      await client.query(
        `UPDATE subscriptions
         SET plan = $2, status = $4, ends_at = $3, updated_at = now()
         WHERE id = $1`,
        [sub.id, plan, endsAt, status]
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
