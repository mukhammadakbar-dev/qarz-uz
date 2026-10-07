import { Writable } from 'node:stream';
import type { UserFromGetMe } from 'grammy/types';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_APP_URL } from '../../../test/env.js';
import { signInitData } from '../../../test/init-data.js';
import { createBot } from '../../bot/bot.js';
import { loadConfig } from '../../config/index.js';
import { createPool } from '../../db/pool.js';
import { buildServer, WEBHOOK_PATH } from '../../http/server.js';
import { createLogger } from '../../observability/logger.js';
import { findUserById, upsertTelegramUser } from './users.js';

const BOT_TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const SECRET = 'test_webhook_secret_1234567890';
const config = loadConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  DATABASE_URL: TEST_APP_URL,
  TELEGRAM_BOT_TOKEN: BOT_TOKEN,
  TELEGRAM_WEBHOOK_SECRET: SECRET,
  SESSION_SECRET: 's'.repeat(32),
});

let pool: Pool;
let app: ReturnType<typeof buildServer>;
let seenUserIds: string[];
let tg = 7_000_000_000 + Math.floor(Math.random() * 1_000_000);
const newTelegramId = () => tg++;
let updateId = 5_000_000 + Math.floor(Math.random() * 1_000_000);

beforeAll(async () => {
  pool = createPool(TEST_APP_URL, { max: 4 });
  const logger = createLogger(config, new Writable({ write: (_c, _e, cb) => cb() }));
  const bot = createBot({
    config,
    logger,
    pool,
    botInfo: { id: 1, is_bot: true, first_name: 'T', username: 'tdaftar_bot' } as UserFromGetMe,
  });
  bot.api.config.use(async () => ({ ok: true, result: true }) as never);
  seenUserIds = [];
  bot.on('message', (ctx) => {
    seenUserIds.push(ctx.user.id);
  });
  app = buildServer({ config, logger, pool, bot });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('upsertTelegramUser', () => {
  it('yangi foydalanuvchi yaratadi, katta Telegram ID bilan ham', async () => {
    const id = newTelegramId();
    expect(id).toBeGreaterThan(2 ** 32);
    const u = await upsertTelegramUser(pool, { id, first_name: 'Ali', username: 'ali' });
    expect(u).toMatchObject({
      telegramUserId: id,
      firstName: 'Ali',
      username: 'ali',
      locale: 'uz-Latn',
    });
    expect(u.activeBusinessId).toBeNull();
  });

  it('o‘zgarmagan profil uchun yozuv qilmaydi, o‘zgargan bo‘lsa yangilaydi', async () => {
    const id = newTelegramId();
    const a = await upsertTelegramUser(pool, { id, first_name: 'Vali' });
    const before = await pool.query('SELECT updated_at FROM users WHERE id = $1', [a.id]);
    const b = await upsertTelegramUser(pool, { id, first_name: 'Vali' });
    const after = await pool.query('SELECT updated_at FROM users WHERE id = $1', [a.id]);
    expect(b.id).toBe(a.id);
    expect(after.rows[0].updated_at).toEqual(before.rows[0].updated_at);

    const c = await upsertTelegramUser(pool, { id, first_name: 'Valijon', username: 'vali' });
    expect(c).toMatchObject({ id: a.id, firstName: 'Valijon', username: 'vali' });
  });

  it('parallel upsert bitta foydalanuvchi qoldiradi', async () => {
    const id = newTelegramId();
    const users = await Promise.all(
      Array.from({ length: 8 }, () => upsertTelegramUser(pool, { id, first_name: 'Par' })),
    );
    expect(new Set(users.map((u) => u.id)).size).toBe(1);
  });

  it('findUserById mavjud bo‘lmagan ID uchun undefined', async () => {
    expect(await findUserById(pool, '00000000-0000-4000-8000-000000000000')).toBeUndefined();
  });
});

describe('bot: ctx.user', () => {
  const send = (from: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: WEBHOOK_PATH,
      headers: { 'x-telegram-bot-api-secret-token': SECRET },
      payload: {
        update_id: updateId++,
        message: {
          message_id: 1,
          date: 1,
          chat: { id: from['id'], type: 'private' },
          from,
          text: 'salom',
        },
      },
    });

  it('har bir private update uchun foydalanuvchi yaratiladi va handlerga beriladi', async () => {
    const id = newTelegramId();
    seenUserIds.length = 0;
    await send({ id, is_bot: false, first_name: 'Sardor' });
    await send({ id, is_bot: false, first_name: 'Sardor' });
    expect(seenUserIds).toHaveLength(2);
    expect(seenUserIds[0]).toBe(seenUserIds[1]);
    const { rows } = await pool.query('SELECT first_name FROM users WHERE telegram_user_id = $1', [
      id,
    ]);
    expect(rows).toEqual([{ first_name: 'Sardor' }]);
  });

  it('bot yuborgan update e‘tiborsiz qoldiriladi', async () => {
    const id = newTelegramId();
    seenUserIds.length = 0;
    await send({ id, is_bot: true, first_name: 'Robot' });
    expect(seenUserIds).toEqual([]);
    const { rowCount } = await pool.query('SELECT 1 FROM users WHERE telegram_user_id = $1', [id]);
    expect(rowCount).toBe(0);
  });
});

describe('Mini App autentifikatsiyasi', () => {
  const login = (initData: string) =>
    app.inject({ method: 'POST', url: '/api/auth/telegram', payload: { initData } });
  const fresh = (id: number, over: Record<string, string> = {}) =>
    signInitData({
      auth_date: String(Math.floor(Date.now() / 1000) - 5),
      user: JSON.stringify({ id, first_name: 'Mini', username: 'mini' }),
      ...over,
    });

  it('to‘g‘ri initData: token olinadi va /api/me ishlaydi', async () => {
    const id = newTelegramId();
    const res = await login(fresh(id));
    expect(res.statusCode).toBe(200);
    const { token, user } = res.json();
    expect(user).toMatchObject({ firstName: 'Mini', locale: 'uz-Latn' });
    expect(JSON.stringify(res.json())).not.toContain(String(id));

    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.id).toBe(user.id);
  });

  it('yaroqsiz yoki yetishmagan initData → 401/400', async () => {
    expect(
      (
        await login(
          fresh(newTelegramId()).replace(
            /hash=([0-9a-f])/,
            (_m, c: string) => `hash=${c === '0' ? '1' : '0'}`,
          ),
        )
      ).statusCode,
    ).toBe(401);
    expect((await login(signInitData({ auth_date: '1', user: '{"id":1}' }))).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'POST', url: '/api/auth/telegram', payload: {} })).statusCode,
    ).toBe(400);
  });

  it('boshqa bot tokeni bilan imzolangan initData rad etiladi', async () => {
    const forged = signInitData(
      { auth_date: String(Math.floor(Date.now() / 1000)), user: '{"id":840369610}' },
      '999:OTHER_BOT_TOKEN_xxxxxxxxxxxxxxxxxx',
    );
    expect((await login(forged)).statusCode).toBe(401);
  });

  it('/api/me tokensiz, noto‘g‘ri token yoki o‘chirilgan foydalanuvchi bilan 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(401);
    const bad = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: 'Bearer x.y.z' },
    });
    expect(bad.statusCode).toBe(401);
    const basic = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: 'Basic abc' },
    });
    expect(basic.statusCode).toBe(401);
  });
});
