import { Writable } from 'node:stream';
import type { Bot } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_APP_URL, TEST_SYSTEM_URL } from '../../test/env.js';
import { loadConfig } from '../config/index.js';
import { createPool } from '../db/pool.js';
import { buildServer, WEBHOOK_PATH } from '../http/server.js';
import { createLogger } from '../observability/logger.js';
import { createBot, registerFallback, type BotContext } from './bot.js';

const SECRET = 'test_webhook_secret_1234567890';
const config = loadConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  DATABASE_URL: TEST_APP_URL,
  TELEGRAM_BOT_TOKEN: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
  TELEGRAM_WEBHOOK_SECRET: SECRET,
  SESSION_SECRET: 'x'.repeat(32),
  MINIAPP_URL: 'https://nasiya.example.uz/app',
  SUPPORT_PHONE: '+998907900110',
});

let pool: Pool;
/** RLS ni chetlab o'tuvchi rol: faqat tekshiruv uchun (cross-tenant o'qish). */
let sys: Pool;
let bot: Bot<BotContext>;
let app: ReturnType<typeof buildServer>;
let sent: { method: string; payload: Record<string, unknown> }[];
let updateId = 20_000_000 + Math.floor(Math.random() * 1_000_000);
let tgSeq = 8_000_000_000 + Math.floor(Math.random() * 1_000_000);

class Person {
  readonly id = tgSeq++;
  constructor(readonly name: string) {}
  private from() {
    return { id: this.id, is_bot: false, first_name: this.name };
  }
  async text(text: string) {
    const entities = text.startsWith('/')
      ? [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]!.length }]
      : undefined;
    return deliver({
      update_id: updateId++,
      message: {
        message_id: 1,
        date: 1,
        chat: { id: this.id, type: 'private' },
        from: this.from(),
        text,
        ...(entities ? { entities } : {}),
      },
    });
  }
  async press(data: string) {
    return deliver({
      update_id: updateId++,
      callback_query: {
        id: String(updateId),
        from: this.from(),
        chat_instance: 'ci',
        data,
        message: { message_id: 1, date: 1, chat: { id: this.id, type: 'private' } },
      },
    });
  }
  /** Shu odamga yuborilgan xabarlar matnlari. */
  inbox(): string[] {
    return sent
      .filter((s) => s.method === 'sendMessage' && s.payload['chat_id'] === this.id)
      .map((s) => String(s.payload['text']));
  }
  last(): { text: string; markup: Markup | undefined } {
    const m = sent
      .filter((s) => s.method === 'sendMessage' && s.payload['chat_id'] === this.id)
      .at(-1);
    return {
      text: String(m?.payload['text']),
      markup: m?.payload['reply_markup'] as Markup | undefined,
    };
  }
}

async function deliver(update: object) {
  const res = await app.inject({
    method: 'POST',
    url: WEBHOOK_PATH,
    headers: { 'x-telegram-bot-api-secret-token': SECRET },
    payload: update,
  });
  expect(res.statusCode).toBe(200);
}

type Button = { text: string; callback_data?: string; web_app?: { url: string } };
type Markup = { inline_keyboard?: Button[][] };
const buttons = (markup: Markup | undefined): Button[] => (markup?.inline_keyboard ?? []).flat();

beforeAll(async () => {
  pool = createPool(TEST_APP_URL, { max: 6 });
  sys = createPool(TEST_SYSTEM_URL, { max: 2 });
  const logger = createLogger(config, new Writable({ write: (_c, _e, cb) => cb() }));
  bot = createBot({
    config,
    logger,
    pool,
    botInfo: {
      id: 1,
      is_bot: true,
      first_name: 'Kissa',
      username: 'kissauzbot',
    } as UserFromGetMe,
  });
  bot.api.config.use(async (_prev, method, payload) => {
    sent.push({ method, payload: payload as Record<string, unknown> });
    return {
      ok: true,
      result:
        method === 'sendMessage'
          ? { message_id: 1, date: 1, chat: { id: 1, type: 'private' } }
          : true,
    } as never;
  });
  registerFallback(bot);
  app = buildServer({ config, logger, pool, bot });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await Promise.all([pool.end(), sys.end()]);
});
beforeEach(() => {
  sent = [];
});

/** To'liq onboarding: yangi odam biznes ochadi. */
async function onboard(name: string, business: string, lang = 'uz-Latn') {
  const p = new Person(name);
  await p.text('/start');
  await p.press(`lang:${lang}`);
  await p.text(business);
  return p;
}

describe('onboarding', () => {
  it('yangi foydalanuvchi: til tanlash → biznes nomi → biznes yaratildi (Kirill)', async () => {
    const p = new Person('Akbar');
    await p.text('/start');
    expect(p.last().text).toContain('Тилни танланг');
    expect(buttons(p.last().markup).map((b) => b.callback_data)).toEqual([
      'lang:uz-Latn',
      'lang:uz-Cyrl',
    ]);

    await p.press('lang:uz-Cyrl');
    expect(sent.some((s) => s.method === 'answerCallbackQuery')).toBe(true);
    expect(p.inbox().at(-2)).toBe('Тил танланди: Ўзбекча (Кирилл).');
    expect(p.last().text).toContain('номини ёзинг');

    await p.text('  Барака   дўкони ');
    expect(p.last().text).toContain('«Барака дўкони» яратилди');
    expect(p.last().text).toContain('14 кунлик бепул синов');

    const { rows } = await sys.query(
      `SELECT u.locale, b.name, m.role, s.trial_ends_at > now() + interval '13 days' AS trial
         FROM users u JOIN business_members m ON m.user_id = u.id
         JOIN businesses b ON b.id = m.business_id JOIN subscriptions s ON s.business_id = b.id
        WHERE u.telegram_user_id = $1`,
      [p.id],
    );
    expect(rows).toEqual([
      { locale: 'uz-Cyrl', name: 'Барака дўкони', role: 'OWNER', trial: true },
    ]);
  });

  it('noto‘g‘ri nom: qayta so‘raladi, holat saqlanadi, keyin to‘g‘ri nom qabul qilinadi', async () => {
    const p = new Person('Vali');
    await p.text('/start');
    await p.press('lang:uz-Latn');
    await p.text('x'.repeat(101));
    expect(p.last().text).toContain('Qayta yozing');
    await p.text('Vali do‘koni');
    expect(p.last().text).toContain('«Vali do‘koni» yaratildi');
  });

  it('/start qayta bosilsa kutilayotgan holat bekor bo‘ladi (nom sifatida buyruq olinmaydi)', async () => {
    const p = new Person('Ali');
    await p.text('/start');
    await p.press('lang:uz-Latn');
    await p.text('/start');
    expect(p.last().text).toContain('Tilni tanlang');
    // Biznes hali yo'q: oddiy matn biznes yaratishga yo'naltiradi (nom sifatida qabul qilinmaydi)
    await p.text('Salom');
    expect(p.last().text).toBe('Avval biznes yarating: /start');
  });

  it('menyu: nom, rol, obuna holati, Mini App tugmasi va /invite ko‘rsatiladi', async () => {
    const p = await onboard('Sardor', 'Sardor savdo');
    await p.text('/menu');
    const { text, markup } = p.last();
    expect(text).toContain('«Sardor savdo» — Egasi');
    expect(text).toContain('sinov muddati');
    expect(text).toContain('/invite');
    expect(buttons(markup)).toEqual([
      expect.objectContaining({ web_app: { url: 'https://nasiya.example.uz/app' } }),
    ]);
  });

  it('bepul sinov bir marta: ikkinchi biznes muddati tugagan, to‘lov raqami ko‘rsatiladi', async () => {
    const p = await onboard('Zafar', 'Birinchi');
    // Ikkinchi biznes uchun yangi onboarding oqimi: limitdan oshmaguncha ochish mumkin
    // (hozircha bot orqali faqat birinchi biznes yaratiladi; ikkinchisini servis orqali ochamiz)
    const { createBusinessWithOwner } = await import('../modules/tenancy/index.js');
    const user = (await pool.query('SELECT id FROM users WHERE telegram_user_id = $1', [p.id]))
      .rows[0].id;
    const second = await createBusinessWithOwner(pool, user, 'Ikkinchi', { trialDays: 14 });
    expect(second.trialGranted).toBe(false);
    await p.text('/menu');
    expect(p.last().text).toContain('«Ikkinchi» — Egasi');
    expect(p.last().text).toContain('muddati tugagan');
    expect(p.last().text).toContain('+998907900110');
  });
});

describe('xodim taklifi', () => {
  it('egasi havola yaratadi, xodim qo‘shiladi, egasiga xabar boradi, token qayta ishlamaydi', async () => {
    const owner = await onboard('Egasi', 'Baraka');
    await owner.text('/invite');
    const link = owner.last().text.match(/https:\/\/t\.me\/kissauzbot\?start=(inv_[A-Za-z0-9_-]+)/);
    expect(link).not.toBeNull();
    const payload = link![1]!;

    const staff = new Person('Xodim');
    await staff.text(`/start ${payload}`);
    expect(staff.inbox()[0]).toBe('✅ Siz «Baraka» biznesiga xodim sifatida qo‘shildingiz.');
    expect(staff.last().text).toContain('«Baraka» — Xodim');
    expect(staff.last().text).not.toContain('/invite');
    expect(owner.last().text).toContain('Xodim «Baraka» biznesiga xodim sifatida qo‘shildi');

    const third = new Person('Boshqa');
    await third.text(`/start ${payload}`);
    expect(third.last().text).toContain('yaroqsiz');
    expect(third.inbox()).toHaveLength(1);
  });

  it('xodim /invite qila olmaydi', async () => {
    const owner = await onboard('E2', 'Do‘kon2');
    await owner.text('/invite');
    const payload = owner.last().text.match(/start=(inv_[A-Za-z0-9_-]+)/)![1]!;
    const staff = new Person('X2');
    await staff.text(`/start ${payload}`);
    await staff.text('/invite');
    expect(staff.last().text).toBe('Bu amal uchun ruxsatingiz yo‘q.');
  });

  it('biznesi yo‘q foydalanuvchi /invite bossa biznes yaratishga yo‘naltiriladi', async () => {
    const p = new Person('Yangi');
    await p.text('/invite');
    expect(p.last().text).toBe('Avval biznes yarating: /start');
  });

  it('yaroqsiz yoki buzilgan taklif payload', async () => {
    const p = new Person('Hacker');
    for (const bad of ['inv_', 'inv_abc', 'inv_' + 'a'.repeat(32), "inv_'; DROP TABLE users;--"]) {
      await p.text(`/start ${bad}`);
      expect(p.last().text, bad).toContain('yaroqsiz');
    }
  });
});

describe('bir nechta biznes', () => {
  it('tanlash menyusi chiqadi, tanlov a’zolik bilan tekshiriladi', async () => {
    const { createBusinessWithOwner } = await import('../modules/tenancy/index.js');
    const idOf = async (p: Person) =>
      (await sys.query('SELECT id FROM users WHERE telegram_user_id = $1', [p.id])).rows[0]
        .id as string;

    const p = await onboard('Multi', 'Bir');
    const stranger = await onboard('Boshqa', 'Begona do‘kon');
    const userId = await idOf(p);
    const second = await createBusinessWithOwner(pool, userId, 'Ikki', { trialDays: 14 });
    // active_business_id ni tozalab, tanlash menyusini majburlaymiz
    await sys.query('UPDATE users SET active_business_id = NULL WHERE id = $1', [userId]);

    await p.text('/start');
    expect(p.last().text).toBe('Qaysi biznes bilan ishlaymiz?');
    expect(
      buttons(p.last().markup)
        .map((b) => b.text)
        .toSorted(),
    ).toEqual(['Bir', 'Ikki']);

    await p.press(`biz:${second.businessId}`);
    expect(p.last().text).toContain('«Ikki» — Egasi');

    // Begona biznes: a'zo emas → ruxsat yo'q, aktiv biznes o'zgarmaydi
    const foreignId = (
      await sys.query('SELECT business_id FROM business_members WHERE user_id = $1', [
        await idOf(stranger),
      ])
    ).rows[0].business_id as string;
    await p.press(`biz:${foreignId}`);
    expect(p.last().text).toBe('Bu amal uchun ruxsatingiz yo‘q.');
    const active = await sys.query('SELECT active_business_id FROM users WHERE id = $1', [userId]);
    expect(active.rows[0].active_business_id).toBe(second.businessId);
  });
});

describe('boshqa buyruqlar', () => {
  it('/help va /lang', async () => {
    const p = new Person('Help');
    await p.text('/help');
    expect(p.last().text).toContain('Murod 450 ming');
    await p.text('/lang');
    expect(buttons(p.last().markup)).toHaveLength(2);
    await p.press('lang:uz-Cyrl');
    await p.text('/help');
    expect(p.last().text).toContain('Мурод 450 минг');
  });

  it('noma’lum callback ma’lumoti e’tiborsiz qoldiriladi', async () => {
    const p = new Person('Cb');
    await p.press('lang:ru');
    await p.press('biz:not-a-uuid');
    expect(p.inbox()).toEqual([]);
  });
});
