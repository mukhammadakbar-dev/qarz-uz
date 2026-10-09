import { subscriptionRequestUrl } from '@nasiya/shared';
import type { Pool } from 'pg';
import { t } from '../../i18n/index.js';
import type { Logger } from '../../observability/logger.js';
import { ENDS_SQL } from '../admin/service.js';
import type { Locale } from '../identity/index.js';

/**
 * Obuna eslatmalari (ADR-0005, T5.2): tugashiga 3 kun va 1 kun qolganda, hamda tugagan kuni — egaga.
 * Har eslatma `notifications.key` bilan bir marta: avval da'vo (INSERT ... ON CONFLICT DO NOTHING), keyin yuborish.
 * Vaqtinchalik xatoda da'vo o'chiriladi (keyingi yurishda qayta), bot bloklangan bo'lsa BLOCKED qoladi.
 * Kechasi yuborilmaydi: faqat Toshkent vaqti bilan 09:00–21:00.
 */

export type ReminderKind = 'SUB_3D' | 'SUB_1D' | 'SUB_EXPIRED';

export const QUIET_HOURS = { from: 21, to: 9 } as const;
/** Ishga tushgandan keyin eski tugaganlarga "tugadi" yuborilmasin: faqat oxirgi 2 kun. */
const EXPIRED_WINDOW_DAYS = 2;

export interface DueReminder {
  readonly key: string;
  readonly kind: ReminderKind;
  readonly businessId: string;
  readonly name: string;
  readonly shortCode: string;
  readonly endsAt: Date;
  readonly isTrial: boolean;
  readonly ownerTelegramId: number;
  readonly ownerLocale: Locale;
}

/** Hozir yuborilishi kerak bo'lgan (hali yuborilmagan) eslatmalar. */
export async function findDueReminders(sys: Pool, now: Date): Promise<DueReminder[]> {
  const { rows } = await sys.query<{
    key: string;
    kind: ReminderKind;
    id: string;
    name: string;
    short_code: string;
    ends_at: Date;
    is_trial: boolean;
    owner_tg: string;
    owner_locale: Locale;
  }>(
    `WITH b AS (
       SELECT b.id, b.name, b.short_code, u.telegram_user_id::text AS owner_tg, u.locale AS owner_locale,
              ${ENDS_SQL} AS ends_at,
              (s.paid_until IS NULL OR s.paid_until <= s.trial_ends_at) AS is_trial
         FROM businesses b
         JOIN subscriptions s ON s.business_id = b.id
         JOIN users u ON u.id = b.owner_user_id
        WHERE b.suspended_at IS NULL
          AND ${ENDS_SQL} > $1::timestamptz - make_interval(days => $2)
          AND ${ENDS_SQL} <= $1::timestamptz + interval '3 days'
     ), k AS (
       SELECT b.*,
              CASE WHEN ends_at <= $1 THEN 'SUB_EXPIRED'
                   WHEN ends_at <= $1::timestamptz + interval '1 day' THEN 'SUB_1D'
                   ELSE 'SUB_3D' END AS kind
         FROM b
     )
     SELECT k.*, k.id::text || ':' || k.kind || ':' || to_char(k.ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') AS key
       FROM k
      WHERE NOT EXISTS (
        SELECT 1 FROM notifications n
         WHERE n.key = k.id::text || ':' || k.kind || ':' || to_char(k.ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS')
      )
      ORDER BY k.ends_at`,
    [now, EXPIRED_WINDOW_DAYS],
  );
  return rows.map((r) => ({
    key: r.key,
    kind: r.kind,
    businessId: r.id,
    name: r.name,
    shortCode: r.short_code,
    endsAt: r.ends_at,
    isTrial: r.is_trial,
    ownerTelegramId: Number(r.owner_tg),
    ownerLocale: r.owner_locale,
  }));
}

const formatDate = (d: Date): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tashkent',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
    .format(d)
    .replaceAll('/', '.');

const tashkentHour = (d: Date): number =>
  Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Tashkent',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(d),
  );

export const isQuietHour = (now: Date): boolean => {
  const h = tashkentHour(now);
  return h >= QUIET_HOURS.from || h < QUIET_HOURS.to;
};

export function reminderText(r: DueReminder, now: Date): string {
  const l = r.ownerLocale;
  const what = t(l, r.isTrial ? 'reminder.trial' : 'reminder.paid');
  const params = { name: r.name, what, date: formatDate(r.endsAt) };
  if (r.kind === 'SUB_EXPIRED') return t(l, 'reminder.expired', params);
  if (r.kind === 'SUB_1D') return t(l, 'reminder.oneDay', params);
  const days = Math.max(2, Math.ceil((r.endsAt.getTime() - now.getTime()) / 86_400_000));
  return t(l, 'reminder.days', { ...params, days });
}

export interface ReminderDeps {
  readonly sys: Pool;
  readonly logger: Logger;
  readonly supportPhone: string | undefined;
  readonly send: (
    chatId: number,
    text: string,
    button?: { readonly text: string; readonly url: string },
  ) => Promise<unknown>;
  /** Vaqtinchalik bo'lmagan yuborish xatolari bo'lsa operatorga (T6.3). */
  readonly alert?: (key: string, text: string) => void;
}

export interface ReminderRun {
  readonly skipped: boolean;
  readonly sent: number;
  readonly blocked: number;
  readonly failed: number;
}

export async function runReminders(deps: ReminderDeps, now = new Date()): Promise<ReminderRun> {
  if (isQuietHour(now)) return { skipped: true, sent: 0, blocked: 0, failed: 0 };
  const due = await findDueReminders(deps.sys, now);
  let sent = 0;
  let blocked = 0;
  let failed = 0;
  for (const r of due) {
    const claimed = await deps.sys.query(
      'INSERT INTO notifications (key, business_id, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [r.key, r.businessId, r.kind],
    );
    if (claimed.rowCount === 0) continue; // boshqa yurish allaqachon yuborgan
    const phone = deps.supportPhone;
    const text =
      reminderText(r, now) + (phone ? `\n${t(r.ownerLocale, 'status.pay', { phone })}` : '');
    const button = phone
      ? {
          text: t(r.ownerLocale, 'button.contactAdmin'),
          url: subscriptionRequestUrl(phone, r.ownerLocale, r.shortCode),
        }
      : undefined;
    try {
      await deps.send(r.ownerTelegramId, text, button);
      sent++;
    } catch (error) {
      const code = (error as { error_code?: number }).error_code;
      if (code === 403) {
        blocked++;
        await deps.sys.query("UPDATE notifications SET status = 'BLOCKED' WHERE key = $1", [r.key]);
      } else {
        failed++;
        await deps.sys.query('DELETE FROM notifications WHERE key = $1', [r.key]);
        deps.logger.warn({ err: error, businessId: r.businessId }, 'obuna eslatmasi yuborilmadi');
      }
    }
  }
  if (sent + blocked + failed > 0) deps.logger.info({ sent, blocked, failed }, 'obuna eslatmalari');
  if (failed > 0)
    deps.alert?.(
      'reminders',
      `⚠️ Kissa: ${failed} ta obuna eslatmasi yuborilmadi (keyingi yurishda qayta urinadi).`,
    );
  return { skipped: false, sent, blocked, failed };
}

/** Har 30 daqiqada (eslatma 3 kun/1 kun oralig'ida bo'lgani uchun aniqlik yetarli). */
export function scheduleReminders(deps: ReminderDeps, everyMs = 30 * 60 * 1000): () => void {
  const tick = () => {
    runReminders(deps).catch((error: unknown) =>
      deps.logger.error({ err: error }, 'obuna eslatmalari xatosi'),
    );
  };
  const timer = setInterval(tick, everyMs);
  timer.unref();
  setTimeout(tick, 60_000).unref();
  return () => clearInterval(timer);
}
