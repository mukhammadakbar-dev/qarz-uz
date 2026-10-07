import { Writable } from 'node:stream';
import type { Bot } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_APP_URL } from '../../test/env.js';
import { createBot, type BotContext } from '../bot/bot.js';
import { loadConfig } from '../config/index.js';
import { createPool } from '../db/pool.js';
import { createLogger } from '../observability/logger.js';
import { buildServer, WEBHOOK_PATH } from './server.js';

const SECRET = 'test_webhook_secret_1234567890';
const config = loadConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  DATABASE_URL: TEST_APP_URL,
  TELEGRAM_BOT_TOKEN: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
  TELEGRAM_WEBHOOK_SECRET: SECRET,
  SESSION_SECRET: 'x'.repeat(32),
});
const botInfo = {
  id: 123456789,
  is_bot: true,
  first_name: 'Kissa',
  username: 'kissauzbot',
} as UserFromGetMe;

let pool: Pool;
let bot: Bot<BotContext>;
let app: ReturnType<typeof buildServer>;
let sent: { method: string; payload: Record<string, unknown> }[];
let handled: { chatId: number; text: string; at: number; end?: number }[];
let nextId = 1_000_000 + Math.floor(Math.random() * 1_000_000);

const message = (chatId: number, text: string, chatType: 'private' | 'group' = 'private') => ({
  update_id: nextId++,
  message: {
    message_id: 1,
    date: 1,
    chat: { id: chatId, type: chatType, first_name: 'T' },
    from: { id: chatId, is_bot: false, first_name: 'T' },
    text,
  },
});

const post = (body: unknown, secret: string | null = SECRET) =>
  app.inject({
    method: 'POST',
    url: WEBHOOK_PATH,
    headers: secret === null ? {} : { 'x-telegram-bot-api-secret-token': secret },
    payload: body as object,
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  pool = createPool(TEST_APP_URL, { max: 4 });
  const logger = createLogger(config, new Writable({ write: (_c, _e, cb) => cb() }));
  bot = createBot({ config, logger, pool, handlers: false, botInfo });
  // Telegram'ga haqiqiy so'rov ketmaydi: chiquvchi API chaqiruvlari yig'iladi.
  bot.api.config.use(async (_prev, method, payload) => {
    sent.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: true } as never;
  });
  bot.on('message:text', async (ctx) => {
    const entry = {
      chatId: ctx.chat.id,
      text: ctx.message.text,
      at: Date.now(),
    } as (typeof handled)[number];
    handled.push(entry);
    if (ctx.message.text === 'boom') throw new Error('maxfiy: Murod 450 ming');
    if (ctx.message.text.startsWith('slow')) await sleep(80);
    entry.end = Date.now();
    await ctx.reply('ok');
  });
  app = buildServer({ config, logger, pool, bot });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});
beforeEach(() => {
  sent = [];
  handled = [];
});

describe('webhook xavfsizligi', () => {
  it('secret yo‘q yoki noto‘g‘ri bo‘lsa 401 va handler chaqirilmaydi', async () => {
    expect((await post(message(1, 'a'), null)).statusCode).toBe(401);
    expect((await post(message(1, 'a'), 'boshqa_secret_1234567890')).statusCode).toBe(401);
    expect((await post(message(1, 'a'), '')).statusCode).toBe(401);
    expect(handled).toEqual([]);
  });

  it('update_id yo‘q tana 400 qaytaradi', async () => {
    expect((await post({ hello: 'world' })).statusCode).toBe(400);
    expect((await post({ update_id: 'x' })).statusCode).toBe(400);
    expect(handled).toEqual([]);
  });

  it('juda katta tana rad etiladi', async () => {
    const res = await post({ update_id: nextId++, pad: 'x'.repeat(300 * 1024) });
    expect(res.statusCode).toBe(413);
  });

  it('GET orqali webhook ochilmaydi', async () => {
    const res = await app.inject({ method: 'GET', url: WEBHOOK_PATH });
    expect(res.statusCode).toBe(404);
  });
});

describe('update ishlovi', () => {
  it('to‘g‘ri update bir marta ishlanadi va javob yuboriladi', async () => {
    const res = await post(message(11, 'salom'));
    expect(res.statusCode).toBe(200);
    expect(handled).toHaveLength(1);
    expect(sent.map((s) => s.method)).toEqual(['sendMessage']);
  });

  it('AC-05: bir xil update_id ikki marta kelsa faqat bir marta ishlanadi', async () => {
    const update = message(12, 'dublikat');
    const results = await Promise.all([post(update), post(update), post(update)]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    expect(handled).toHaveLength(1);
    expect((await post(update)).statusCode).toBe(200);
    expect(handled).toHaveLength(1);
  });

  it('guruh chatidan kelgan update e‘tiborsiz qoldiriladi', async () => {
    const res = await post(message(-100123, 'guruh', 'group'));
    expect(res.statusCode).toBe(200);
    expect(handled).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('handler xatosi: 200, foydalanuvchiga umumiy xabar, tafsilot sizmaydi, qayta ishlanmaydi', async () => {
    const update = message(13, 'boom');
    expect((await post(update)).statusCode).toBe(200);
    expect(sent).toHaveLength(1);
    const text = String(sent[0]?.payload['text']);
    expect(text).toContain('xatolik');
    expect(text).not.toContain('Murod');
    expect((await post(update)).statusCode).toBe(200);
    expect(handled).toHaveLength(1);
  });
});

describe('bir chat ichida ketma-ketlik', () => {
  it('bir chatdagi update’lar ustma-ust tushmaydi va tartibni saqlaydi', async () => {
    await Promise.all([
      post(message(21, 'slow-1')),
      post(message(21, 'slow-2')),
      post(message(21, 'slow-3')),
    ]);
    expect(handled.map((h) => h.text)).toEqual(['slow-1', 'slow-2', 'slow-3']);
    for (let i = 1; i < handled.length; i++) {
      expect(handled[i]!.at).toBeGreaterThanOrEqual(handled[i - 1]!.end!);
    }
  });

  it('turli chatlar parallel ishlaydi', async () => {
    const started = Date.now();
    await Promise.all([
      post(message(31, 'slow-a')),
      post(message(32, 'slow-b')),
      post(message(33, 'slow-c')),
    ]);
    expect(handled).toHaveLength(3);
    expect(Date.now() - started).toBeLessThan(80 * 3);
  });
});

describe('health', () => {
  it('/healthz va /readyz', async () => {
    expect((await app.inject({ method: 'GET', url: '/healthz' })).json()).toEqual({ status: 'ok' });
    expect((await app.inject({ method: 'GET', url: '/readyz' })).json()).toEqual({
      status: 'ready',
    });
  });
});
