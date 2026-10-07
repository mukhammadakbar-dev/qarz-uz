import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import type { UserFromGetMe } from 'grammy/types';
import type { Pool } from 'pg';
import { createBot } from '../src/bot/bot.js';
import { loadConfig } from '../src/config/index.js';
import { createPool } from '../src/db/pool.js';
import { buildServer } from '../src/http/server.js';
import { issueSessionToken } from '../src/modules/identity/index.js';
import { createLogger } from '../src/observability/logger.js';
import { resolveBusinessAccess } from '../src/modules/tenancy/index.js';
import { TEST_APP_URL, TEST_SYSTEM_URL } from './env.js';
import * as fx from './fixtures.js';

/** Mini App API sinovlari uchun: real Postgres + soxta Telegram API; HTTP so'rovlar `app.inject` orqali. */

export const SESSION_SECRET = 's'.repeat(32);

export interface CallOptions {
  readonly token?: string | null;
  readonly businessId?: string;
  readonly body?: unknown;
  /** Idempotency-Key; true — yangi tasodifiy kalit. */
  readonly key?: string | true;
  readonly headers?: Record<string, string>;
}

export interface ApiHarness {
  readonly app: ReturnType<typeof buildServer>;
  readonly pool: Pool;
  readonly sys: Pool;
  readonly sentMessages: { chatId: number; text: string }[];
  call(
    method: string,
    url: string,
    options?: CallOptions,
  ): Promise<{ status: number; body: any; headers: Record<string, unknown> }>;
  tokenFor(userId: string): string;
  /** Egasi + (ixtiyoriy) xodim + biznes. */
  shop(options?: { staff?: boolean }): Promise<Shop>;
  close(): Promise<void>;
}

export interface Shop {
  readonly businessId: string;
  readonly owner: { id: string; token: string; telegramId: number };
  readonly staff: { id: string; token: string; telegramId: number };
  /** Servis orqali tayyorgarlik (HTTP'siz). */
  customer(name: string, debt?: number): Promise<string>;
}

export async function createApiHarness(
  env: Record<string, string> = {},
  options: { miniAppDir?: string } = {},
): Promise<ApiHarness> {
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    DATABASE_URL: TEST_APP_URL,
    TELEGRAM_BOT_TOKEN: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
    TELEGRAM_WEBHOOK_SECRET: 'test_webhook_secret_1234567890',
    SESSION_SECRET,
    SUPPORT_PHONE: '+998907900110',
    MINIAPP_URL: 'https://nasiya.example.uz/app',
    API_RATE_LIMIT_PER_MINUTE: '100000',
    ...env,
  });
  const pool = createPool(TEST_APP_URL, { max: 10 });
  const sys = createPool(TEST_SYSTEM_URL, { max: 2 });
  const logger = createLogger(config, new Writable({ write: (_c, _e, cb) => cb() }));
  const bot = createBot({
    config,
    logger,
    pool,
    handlers: false,
    botInfo: {
      id: 1,
      is_bot: true,
      first_name: 'Kissa',
      username: 'kissauzbot',
    } as UserFromGetMe,
  });
  const sentMessages: { chatId: number; text: string }[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    if (method === 'sendMessage') {
      const p = payload as { chat_id: number; text: string };
      sentMessages.push({ chatId: p.chat_id, text: p.text });
    }
    return {
      ok: true,
      result: { message_id: 1, date: 1, chat: { id: 1, type: 'private' } },
    } as never;
  });
  const app = buildServer({ config, logger, pool, bot, miniAppDir: options.miniAppDir });
  await app.ready();

  const tokenFor = (userId: string) =>
    issueSessionToken(userId, { secret: SESSION_SECRET, ttlSeconds: 3600 }).token;

  return {
    app,
    pool,
    sys,
    sentMessages,
    tokenFor,
    async call(method, url, callOptions = {}) {
      const headers: Record<string, string> = { ...callOptions.headers };
      if (callOptions.token) headers['authorization'] = `Bearer ${callOptions.token}`;
      if (callOptions.businessId) headers['x-business-id'] = callOptions.businessId;
      if (callOptions.key)
        headers['idempotency-key'] = callOptions.key === true ? randomUUID() : callOptions.key;
      const res = await app.inject({
        method: method as 'GET',
        url,
        headers,
        ...(callOptions.body !== undefined ? { payload: callOptions.body as object } : {}),
      });
      let body: any = null;
      try {
        body = res.body ? JSON.parse(res.body) : null;
      } catch {
        body = res.body;
      }
      return { status: res.statusCode, body, headers: res.headers };
    },
    async shop(shopOptions = {}) {
      const tg = async () => {
        const id = await fx.createUser(pool, 'u');
        const { rows } = await sys.query('SELECT telegram_user_id FROM users WHERE id = $1', [id]);
        return { id, telegramId: Number(rows[0].telegram_user_id) };
      };
      const owner = await tg();
      const staff = await tg();
      const businessId = await fx.createBusiness(pool, owner.id, 'Test do‘kon');
      if (shopOptions.staff !== false) await fx.addMember(pool, businessId, owner.id, staff.id);
      const ownerAccess = await resolveBusinessAccess(pool, {
        id: owner.id,
        activeBusinessId: businessId,
      });
      const { createCustomer } = await import('../src/modules/customers/index.js');
      const { postDebt } = await import('../src/modules/ledger/index.js');
      return {
        businessId,
        owner: { ...owner, token: tokenFor(owner.id) },
        staff: { ...staff, token: tokenFor(staff.id) },
        async customer(name, debt) {
          const c = await createCustomer(pool, ownerAccess, { name });
          if (debt)
            await postDebt(pool, ownerAccess, {
              customerId: c.id,
              amount: debt,
              idempotencyKey: randomUUID(),
              source: 'SYSTEM',
            });
          return c.id;
        },
      };
    },
    async close() {
      await app.close();
      await Promise.all([pool.end(), sys.end()]);
    },
  };
}
