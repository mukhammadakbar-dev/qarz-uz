import cron from 'node-cron';
import { query } from '../db/pool.js';
import { createPaymentLink } from './payment.service.js';
import { notifyDebtor, renderTemplate } from './notification.service.js';

/**
 * Daily reminder sweep: find debts due within `days_before` (per shop settings)
 * or already overdue, and send reminders through the preferred channel with
 * automatic Telegram -> SMS fallback.
 */
export const runReminderSweep = async () => {
  console.log('[cron] Running reminder sweep...');

  // Candidate debts: unpaid, due within the shop's lead time (or overdue).
  // sent_count / last_sent_at let us honour repeat_count and repeat_interval_days
  // without sending a fresh reminder every single day.
  const { rows } = await query(`
    SELECT dt.id AS debt_id, dt.amount, dt.paid_amount, dt.due_date,
           d.id AS debtor_id, d.full_name, d.phone, d.telegram_id, d.shop_id,
           COALESCE(rs.days_before, 1) AS days_before,
           COALESCE(rs.repeat_count, 2) AS repeat_count,
           COALESCE(rs.repeat_interval_days, 3) AS repeat_interval_days,
           COALESCE(rs.template, 'Hurmatli {name}, {amount} so''m qarz muddati {due}. To''lov: {link}') AS template,
           (SELECT COUNT(*) FROM notifications n
              WHERE n.debt_id = dt.id AND n.status = 'sent') AS sent_count,
           (SELECT MAX(n.sent_at) FROM notifications n
              WHERE n.debt_id = dt.id AND n.status = 'sent') AS last_sent_at
    FROM debts dt
    JOIN debtors d ON d.id = dt.debtor_id
    LEFT JOIN reminder_settings rs ON rs.shop_id = d.shop_id
    WHERE dt.status <> 'paid'
      AND dt.due_date IS NOT NULL
      AND dt.due_date <= CURRENT_DATE + COALESCE(rs.days_before, 1)
  `);

  for (const r of rows) {
    try {
      // stop once the configured number of reminders has been sent
      if (Number(r.sent_count) >= Number(r.repeat_count)) continue;

      // respect the spacing between reminders (and never twice in one day)
      if (r.last_sent_at) {
        const daysSince =
          (Date.now() - new Date(r.last_sent_at).getTime()) / 864e5;
        if (daysSince < Number(r.repeat_interval_days)) continue;
      }

      // belt-and-braces: never send twice on the same calendar day
      const dup = await query(
        `SELECT 1 FROM notifications
         WHERE debt_id = $1 AND created_at::date = CURRENT_DATE AND status = 'sent' LIMIT 1`,
        [r.debt_id]
      );
      if (dup.rows.length) continue;

      const link = await createPaymentLink(r.debt_id).catch(() => null);
      const body = renderTemplate(r.template, {
        name: r.full_name,
        amount: Number(r.amount) - Number(r.paid_amount),
        due: r.due_date?.toISOString?.().slice(0, 10) || String(r.due_date),
        link: link?.url || '',
      });

      await notifyDebtor({
        debtor: {
          id: r.debtor_id,
          phone: r.phone,
          telegram_id: r.telegram_id,
          shop_id: r.shop_id,
        },
        debt: { id: r.debt_id },
        body,
      });
    } catch (err) {
      console.error(`[cron] reminder failed for debt ${r.debt_id}:`, err.message);
    }
  }

  // mark overdue debts
  await query(
    `UPDATE debts SET status = 'overdue', updated_at = now()
     WHERE status IN ('open','partial') AND due_date < CURRENT_DATE`
  );

  console.log(`[cron] Sweep done. Candidates: ${rows.length}`);
};

/**
 * Roll each shop's monthly SMS allowance over into a new period.
 *
 * sms_balance carries monthly_limit and period_start, and plans are sold as
 * "N SMS per month", but nothing ever reset `remaining`. A shop that used its
 * 30 free messages simply stopped being able to send reminders — permanently.
 *
 * Purchased extra_package credits do not expire, so they are left untouched.
 */
export const resetMonthlySmsBalances = async () => {
  const { rowCount } = await query(
    `UPDATE sms_balance
     SET remaining    = monthly_limit,
         period_start = date_trunc('month', CURRENT_DATE)::date,
         updated_at   = now()
     WHERE period_start < date_trunc('month', CURRENT_DATE)::date`
  );
  if (rowCount) console.log(`[cron] SMS balances reset for ${rowCount} shop(s)`);
  return rowCount;
};

/**
 * Guards against two failure modes of the raw cron callback:
 *
 *  - node-cron does not await or catch the returned promise, so any rejection
 *    (a dropped DB connection during the initial query, say) became an
 *    unhandled rejection — fatal by default on modern Node.
 *  - a sweep that outruns its schedule would otherwise start again on top of
 *    itself and send every reminder twice.
 */
let sweepRunning = false;

const runSweepGuarded = async () => {
  if (sweepRunning) {
    console.warn('[cron] Previous sweep still running, skipping this tick');
    return;
  }
  sweepRunning = true;
  try {
    // Roll balances over first, so a shop entering a new month can actually
    // send the reminders this sweep is about to queue.
    await resetMonthlySmsBalances();
    await runReminderSweep();
  } catch (err) {
    console.error('[cron] Reminder sweep failed:', err);
  } finally {
    sweepRunning = false;
  }
};

/**
 * Schedule the sweep daily at 09:00 (Asia/Tashkent).
 * Returns the task so callers (e.g. graceful shutdown) can stop it.
 */
export const startScheduler = () => {
  const task = cron.schedule('0 9 * * *', runSweepGuarded, { timezone: 'Asia/Tashkent' });
  console.log('[cron] Reminder scheduler started (daily 09:00 Asia/Tashkent)');
  return task;
};
