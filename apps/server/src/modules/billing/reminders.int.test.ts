import { Writable } from 'node:stream';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_APP_URL, TEST_SYSTEM_URL } from '../../../test/env.js';
import * as fx from '../../../test/fixtures.js';
import { loadConfig } from '../../config/index.js';
import { createPool } from '../../db/pool.js';
import { createLogger } from '../../observability/logger.js';
import { findDueReminders, runReminders, type ReminderDeps } from './reminders.js';

/**
 * T5.2: eslatmalar 3 kun / 1 kun qolganda va tugagan kuni, har biri bir marta; kechasi yuborilmaydi.
 * Vaqt sun'iy (2031-yil) — boshqa testlarning do'konlari bu oynaga tushmaydi.
 */

const DAY = 86_400_000;
// 2031-03-10 12:00 Toshkent (UTC+5)
const NOW = new Date('2031-03-10T07:00:00Z');

let pool: Pool;
let sys: Pool;
const logger = createLogger(
  loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    DATABASE_URL: TEST_APP_URL,
    TELEGRAM_BOT_TOKEN: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
    TELEGRAM_WEBHOOK_SECRET: 'test_webhook_secret_1234567890',
    SESSION_SECRET: 'x'.repeat(32),
  }),
  new Writable({ write: (_c, _e, cb) => cb() }),
);

beforeAll(() => {
  pool = createPool(TEST_APP_URL, { max: 4 });
  sys = createPool(TEST_SYSTEM_URL, { max: 2 });
});
afterAll(async () => {
  await Promise.all([pool.end(), sys.end()]);
});

interface Shop {
  businessId: string;
  ownerTg: number;
  code: string;
}

/** Do'kon: sinov `trialEnds` da tugaydi, to'langan muddat `paidUntil` (ixtiyoriy). */
async function shop(
  trialEnds: Date,
  paidUntil: Date | null = null,
  suspended = false,
): Promise<Shop> {
  const owner = await fx.createUser(pool, 'Ega');
  const businessId = await fx.createBusiness(
    pool,
    owner,
    `Eslatma ${Math.random().toString(36).slice(2, 6)}`,
  );
  await sys.query(
    'UPDATE subscriptions SET trial_ends_at = $2, paid_until = $3 WHERE business_id = $1',
    [businessId, trialEnds, paidUntil],
  );
  if (suspended)
    await sys.query('UPDATE businesses SET suspended_at = now() WHERE id = $1', [businessId]);
  const { rows } = await sys.query(
    `SELECT u.telegram_user_id::text AS tg, b.short_code FROM businesses b JOIN users u ON u.id = b.owner_user_id WHERE b.id = $1`,
    [businessId],
  );
  return { businessId, ownerTg: Number(rows[0].tg), code: rows[0].short_code };
}

function fakeSend(fail: (chatId: number) => unknown = () => null) {
  const sent: { chatId: number; text: string; url: string | undefined }[] = [];
  const deps: ReminderDeps = {
    sys,
    logger,
    supportPhone: '+998907900110',
    async send(chatId, text, button) {
      const error = fail(chatId);
      if (error) throw error;
      sent.push({ chatId, text, url: button?.url });
    },
  };
  return { deps, sent, to: (s: Shop) => sent.filter((m) => m.chatId === s.ownerTg) };
}

const at = (ms: number) => new Date(NOW.getTime() + ms);

describe('obuna eslatmalari', () => {
  it('3 kun, 1 kun, tugagan kun; har biri bir marta; uzoq yoki eski muddat va bloklangan do‘kon — yo‘q', async () => {
    const three = await shop(at(2.5 * DAY));
    const one = await shop(at(12 * 3600_000));
    const expired = await shop(at(-3600_000));
    const old = await shop(at(-5 * DAY));
    const far = await shop(at(10 * DAY));
    const blocked = await shop(at(2 * DAY), null, true);
    const paid = await shop(at(-20 * DAY), at(2 * DAY));

    const due = await findDueReminders(sys, NOW);
    const kindOf = (s: Shop) => due.filter((d) => d.businessId === s.businessId).map((d) => d.kind);
    expect(kindOf(three)).toEqual(['SUB_3D']);
    expect(kindOf(one)).toEqual(['SUB_1D']);
    expect(kindOf(expired)).toEqual(['SUB_EXPIRED']);
    expect(kindOf(old)).toEqual([]);
    expect(kindOf(far)).toEqual([]);
    expect(kindOf(blocked)).toEqual([]);
    expect(kindOf(paid)).toEqual(['SUB_3D']);

    const { deps, to } = fakeSend();
    await runReminders(deps, NOW);
    expect(to(three)[0]!.text).toContain('bepul sinov muddati 3 kundan keyin (13.03.2031) tugaydi');
    expect(to(one)[0]!.text).toContain('24 soat ichida');
    expect(to(expired)[0]!.text).toContain('tugadi. Yangi yozuv qo‘shish to‘xtatildi');
    expect(to(paid)[0]!.text).toContain('do‘konining obunasi 2 kundan keyin');
    expect(to(three)[0]!.text).toContain('To‘lash uchun: +998907900110');
    // Tugma admin chatini biznes kodi bilan tayyor xabarda ochadi
    expect(decodeURIComponent(to(three)[0]!.url!)).toContain(`ID: \`${three.code}\``);

    // Ikkinchi yurish: hech kimga takror yuborilmaydi
    const again = fakeSend();
    await runReminders(again.deps, NOW);
    for (const s of [three, one, expired, paid]) expect(again.to(s)).toEqual([]);
  });

  it('vaqt o‘tib 1 kun qolganda yangi eslatma; obuna uzaytirilsa yangi muddat uchun qaytadan', async () => {
    const s = await shop(at(2.5 * DAY));
    const { deps, to } = fakeSend();
    await runReminders(deps, NOW);
    await runReminders(deps, at(2 * DAY)); // 12 soat qoldi
    expect(
      to(s).map((m) =>
        m.text.startsWith('⏳') ? '3 kun' : m.text.startsWith('⚠️') ? '1 kun' : m.text,
      ),
    ).toEqual(['3 kun', '1 kun']);

    await sys.query('UPDATE subscriptions SET paid_until = $2 WHERE business_id = $1', [
      s.businessId,
      at(32 * DAY),
    ]);
    await runReminders(deps, at(2 * DAY));
    expect(to(s)).toHaveLength(2); // yangi muddat uzoq: hozircha eslatma yo‘q
    await runReminders(deps, at(30 * DAY));
    expect(to(s)).toHaveLength(3);
    expect(to(s)[2]!.text).toContain('obunasi 2 kundan keyin');
  });

  it('kechasi (21:00–09:00) yuborilmaydi', async () => {
    const s = await shop(at(2 * DAY));
    const { deps, to } = fakeSend();
    // 2031-03-10 23:30 Toshkent
    const night = new Date('2031-03-10T18:30:00Z');
    expect((await runReminders(deps, night)).skipped).toBe(true);
    expect(to(s)).toEqual([]);
  });

  it('botni bloklagan ega — BLOCKED, qayta urinilmaydi; vaqtinchalik xato — keyingi yurishda qayta', async () => {
    const blockedOwner = await shop(at(2 * DAY));
    const flaky = await shop(at(2 * DAY));
    let flakyFails = true;
    const { deps, to } = fakeSend((chatId) => {
      if (chatId === blockedOwner.ownerTg) return { error_code: 403, description: 'Forbidden' };
      if (chatId === flaky.ownerTg && flakyFails) return { error_code: 500, description: 'oops' };
      return null;
    });
    await runReminders(deps, NOW);
    expect(to(flaky)).toEqual([]);
    const statusOf = async (s: Shop) =>
      (await sys.query('SELECT status FROM notifications WHERE business_id = $1', [s.businessId]))
        .rows;
    expect(await statusOf(blockedOwner)).toEqual([{ status: 'BLOCKED' }]);
    expect(await statusOf(flaky)).toEqual([]);

    flakyFails = false;
    await runReminders(deps, NOW);
    expect(to(flaky)).toHaveLength(1);
    expect(to(blockedOwner)).toEqual([]);
  });

  it('ilova roli eslatmalar jadvalini o‘qiy olmaydi', async () => {
    await expect(pool.query('SELECT 1 FROM notifications LIMIT 1')).rejects.toMatchObject({
      code: '42501',
    });
  });
});
