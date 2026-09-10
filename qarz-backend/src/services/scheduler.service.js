import cron from 'node-cron';
import { query, pool } from '../db/pool.js';
import { config } from '../config/index.js';
import { createPaymentLink } from './payment.service.js';
import { notifyDebtor, renderTemplate } from './notification.service.js';
import { purgeExpiredOtps } from './otp.service.js';

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
           COALESCE(rs.template, 'Hurmatli {name}, {amount} so''m qarz muddati {due}.') AS template,
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

      // Only mint a link when the template actually asks for one AND there is
      // a live gateway to honour it. Otherwise every reminder used to burn a
      // row in payment_links for a URL that leads nowhere.
      const wantsLink = config.click.enabled && r.template.includes('{link}');
      const link = wantsLink
        ? await createPaymentLink(r.debt_id).catch(() => null)
        : null;
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

  await retireLapsedSubscriptions();

  console.log(`[cron] Sweep done. Candidates: ${rows.length}`);
};

/**
 * Move subscriptions whose period has ended to 'expired'.
 *
 * Nothing ever wrote that status: enforceSubscription worked expiry out from
 * ends_at on every request and left the row saying 'active'. Everything that
 * read the column instead of recomputing was therefore wrong — most visibly the
 * Super Admin panel, where MRR summed the plan price of every shop that had ever
 * paid, including the long departed, while the "active subscriptions" count
 * beside it filtered on ends_at and fell. Two numbers on one screen
 * contradicting each other, with nothing to say which was lying.
 *
 * 'blocked' is left alone: that is a moderation decision with its own meaning,
 * and overwriting it here would quietly unblock the shop as soon as someone
 * extended its subscription.
 */
export const retireLapsedSubscriptions = async () => {
  const { rowCount } = await query(
    `UPDATE subscriptions SET status = 'expired', updated_at = now()
     WHERE status IN ('active', 'trial') AND ends_at < now()`
  );
  if (rowCount) console.log(`[cron] ${rowCount} subscription(s) marked expired`);
  return rowCount;
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
 * How long a delivered notification stays queryable. Long enough to answer
 * "did my customer get the reminder?" weeks later, short enough that the table
 * does not grow without bound for the life of the deployment.
 */
const NOTIFICATION_RETENTION_DAYS = 180;

/**
 * Drop rows nothing will read again.
 *
 * purgeExpiredOtps has existed since the OTP service was written but was never
 * called from anywhere, so otp_codes grew forever — every login code, every
 * registration attempt, kept indefinitely. `notifications` had no retention at
 * all: one row per reminder, per debt, per day, for as long as the shop exists.
 *
 * Neither is urgent at today's scale, which is exactly why it would have gone
 * unnoticed until it wasn't.
 */
export const purgeOldRecords = async () => {
  const otps = await purgeExpiredOtps();
  // Rows belonging to a debt that is still open are NOT history — they are the
  // reminder counter. runReminderSweep derives sent_count and last_sent_at by
  // counting exactly these rows, so deleting them resets the count to zero and
  // the sweep starts reminding all over again: a debt that went quiet after its
  // two reminders would be reminded twice more every retention period, on the
  // shop's SMS credit, for as long as it stays unpaid.
  const { rowCount: notifs } = await query(
    `DELETE FROM notifications
     WHERE id IN (
       SELECT n.id
       FROM notifications n
       LEFT JOIN debts d ON d.id = n.debt_id
       WHERE n.created_at < now() - ($1 || ' days')::interval
         AND n.status IN ('sent', 'failed')
         -- Keep anything still attached to an unpaid debt. A row with no debt
         -- at all (d.id IS NULL) is pure history and may go.
         AND (d.id IS NULL OR d.status = 'paid')
     )`,
    [NOTIFICATION_RETENTION_DAYS]
  );
  // Forgot-password markers are only read while unexpired, so an expired one is
  // already inert — this just keeps the table from accumulating them.
  const { rowCount: resets } = await query(
    `DELETE FROM password_reset_requests WHERE expires_at < now() - INTERVAL '1 day'`
  );

  if (otps?.rowCount || notifs || resets) {
    console.log(
      `[cron] Purged ${otps?.rowCount || 0} otp row(s), ${notifs} notification(s), ${resets} reset request(s)`
    );
  }
  return { otps: otps?.rowCount || 0, notifications: notifs, resetRequests: resets };
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

/**
 * Arbitrary but fixed: any two processes asking for this same number contend
 * for the same lock. Changing it would let an old and a new deployment run the
 * sweep side by side, which is the exact thing this prevents.
 */
const SWEEP_LOCK_KEY = 4_820_117;

/**
 * Run `fn` only if no other backend process holds the sweep lock.
 *
 * `sweepRunning` above guards one process against overlapping with itself; it
 * says nothing about a second replica. Scale the backend to two containers and
 * both fire at 09:00, so every debtor gets two reminders and every shop pays
 * twice the SMS. pg_try_advisory_lock is the cheapest fix available: it is
 * non-blocking (the loser skips its tick instead of queueing behind the winner)
 * and the lock dies with the session, so a crashed sweep cannot wedge the next
 * one out forever.
 */
const withSweepLock = async (fn) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [SWEEP_LOCK_KEY]);
    if (!rows[0]?.locked) {
      console.log('[cron] Another instance holds the sweep lock, skipping this tick');
      return false;
    }
    try {
      await fn();
      return true;
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [SWEEP_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
};

const runSweepGuarded = async () => {
  if (sweepRunning) {
    console.warn('[cron] Previous sweep still running, skipping this tick');
    return;
  }
  sweepRunning = true;
  try {
    await withSweepLock(async () => {
      // Roll balances over first, so a shop entering a new month can actually
      // send the reminders this sweep is about to queue.
      await resetMonthlySmsBalances();
      await runReminderSweep();
      // Housekeeping last: it must never delay or block the work customers see.
      await purgeOldRecords();
    });
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
