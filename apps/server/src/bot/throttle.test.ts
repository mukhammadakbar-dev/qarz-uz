import { Writable } from 'node:stream';
import type { UserFromGetMe } from 'grammy/types';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config/index.js';
import { createLogger } from '../observability/logger.js';
import { RateLimiter } from '../util/rate-limiter.js';
import { createBot } from './bot.js';
import { retryOn429 } from './throttle.js';

const config = loadConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  DATABASE_URL: 'postgres://x@localhost/x',
  TELEGRAM_BOT_TOKEN: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
  TELEGRAM_WEBHOOK_SECRET: 'test_webhook_secret_1234567890',
  SESSION_SECRET: 'x'.repeat(32),
});
const logger = createLogger(config, new Writable({ write: (_c, _e, cb) => cb() }));

type Res =
  | { ok: true; result: true }
  | { ok: false; error_code: number; description: string; parameters?: { retry_after?: number } };
const tooMany = (retryAfter: number): Res => ({
  ok: false,
  error_code: 429,
  description: 'Too Many Requests',
  parameters: { retry_after: retryAfter },
});

function run(responses: Res[], maxWaitMs?: number) {
  const slept: number[] = [];
  let calls = 0;
  const transformer = retryOn429({ maxWaitMs, sleep: async (ms) => void slept.push(ms) });
  const prev = (async () => responses[Math.min(calls++, responses.length - 1)]) as never;
  return {
    result: transformer(prev, 'sendMessage', { chat_id: 1, text: 'x' } as never),
    slept,
    calls: () => calls,
  };
}

describe('retryOn429', () => {
  it('retry_after ni kutib qayta yuboradi', async () => {
    const r = run([tooMany(2), tooMany(1), { ok: true, result: true }]);
    expect(await r.result).toEqual({ ok: true, result: true });
    expect(r.slept).toEqual([2000, 1000]);
  });

  it('jami kutish chegaradan oshsa xatoni qaytaradi; boshqa xatolarni qayta urinmaydi', async () => {
    const long = run([tooMany(4), tooMany(4)], 5000);
    expect(await long.result).toMatchObject({ ok: false, error_code: 429 });
    expect(long.slept).toEqual([4000]);
    const forbidden = run([{ ok: false, error_code: 403, description: 'Forbidden' }]);
    expect(await forbidden.result).toMatchObject({ error_code: 403 });
    expect(forbidden.calls()).toBe(1);
  });
});

describe('bot: foydalanuvchi chegarasi', () => {
  it('chegaradan oshgan update bazaga yetmaydi; bir marta aytiladi', async () => {
    let dbCalls = 0;
    // rowCount 0: dedupe update'ni to'xtatadi — bizga faqat bazaga yetganmi, shu kerak
    const pool = { query: async () => (dbCalls++, { rowCount: 0, rows: [] }) } as unknown as Pool;
    const bot = createBot({
      config,
      logger,
      pool,
      handlers: false,
      rateLimiter: new RateLimiter({ perMinute: 2, burst: 2 }),
      botInfo: {
        id: 1,
        is_bot: true,
        first_name: 'Kissa',
        username: 'kissauzbot',
      } as UserFromGetMe,
    });
    const sent: { method: string; payload: Record<string, unknown> }[] = [];
    bot.api.config.use(async (_prev, method, payload) => {
      sent.push({ method, payload: payload as Record<string, unknown> });
      return { ok: true, result: true } as never;
    });
    const from = { id: 42, is_bot: false, first_name: 'Ali' };
    const message = (id: number) => ({
      update_id: id,
      message: {
        message_id: id,
        date: 1,
        chat: { id: 42, type: 'private' as const, first_name: 'Ali' },
        from,
        text: 'salom',
      },
    });
    for (let i = 1; i <= 5; i++) await bot.handleUpdate(message(i));
    await bot.handleUpdate({
      update_id: 6,
      callback_query: {
        id: 'cb',
        from,
        chat_instance: 'ci',
        data: 'x',
        message: message(6).message,
      },
    });
    expect(dbCalls).toBe(2);
    expect(sent.map((s) => s.method)).toEqual(['sendMessage', 'answerCallbackQuery']);
    expect(sent[0]!.payload['text']).toContain('Juda tez');
    expect(sent[1]!.payload['text']).toBeUndefined(); // jim: faqat tugma "aylanishi" to'xtatiladi
  });
});
