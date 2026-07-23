import { query } from '../db/pool.js';
import { sendSms } from './sms.service.js';
import { sendTelegramMessage } from './telegram.service.js';

/**
 * Decide channel and dispatch a notification to a debtor.
 * Logic (TZ 4.3): if telegram_id exists -> Telegram, else -> SMS.
 * SMS path decrements the shop's SMS balance.
 */
export const notifyDebtor = async ({ debtor, debt, body }) => {
  const channel = debtor.telegram_id ? 'telegram' : 'sms';

  // create pending notification row
  const { rows } = await query(
    `INSERT INTO notifications (debtor_id, debt_id, channel, body, status)
     VALUES ($1,$2,$3,$4,'pending') RETURNING id`,
    [debtor.id, debt?.id || null, channel, body]
  );
  const notifId = rows[0].id;

  let result;
  if (channel === 'telegram') {
    result = await sendTelegramMessage(debtor.telegram_id, body);
  } else {
    // check + decrement SMS balance for the shop
    if (debtor.shop_id) {
      const bal = await query(
        'SELECT remaining, extra_package FROM sms_balance WHERE shop_id = $1',
        [debtor.shop_id]
      );
      const b = bal.rows[0];
      const available = b ? b.remaining + b.extra_package : 0;
      if (available <= 0) {
        await query('UPDATE notifications SET status = $1 WHERE id = $2', ['failed', notifId]);
        return { ok: false, channel, error: 'SMS balansi tugagan' };
      }
    }
    result = await sendSms(debtor.phone, body);
    if (result.ok && debtor.shop_id) {
      // decrement free limit first, then extra package
      await query(
        `UPDATE sms_balance
         SET remaining = GREATEST(remaining - 1, 0),
             extra_package = CASE WHEN remaining <= 0 THEN GREATEST(extra_package - 1, 0) ELSE extra_package END,
             updated_at = now()
         WHERE shop_id = $1`,
        [debtor.shop_id]
      );
    }
  }

  await query(
    `UPDATE notifications SET status = $1, sent_at = CASE WHEN $1 = 'sent' THEN now() ELSE NULL END WHERE id = $2`,
    [result.ok ? 'sent' : 'failed', notifId]
  );

  return { ok: result.ok, channel, error: result.error };
};

/**
 * Fill a reminder template with debt data.
 */
export const renderTemplate = (template, { name, amount, due, link }) =>
  template
    .replaceAll('{name}', name || '')
    .replaceAll('{amount}', amount != null ? Number(amount).toLocaleString('uz-UZ') : '')
    .replaceAll('{due}', due || '')
    .replaceAll('{link}', link || '');
