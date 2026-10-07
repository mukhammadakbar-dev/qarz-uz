import { Writable } from 'node:stream';
import type { UserFromGetMe } from 'grammy/types';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_APP_URL } from '../../test/env.js';
import * as fx from '../../test/fixtures.js';
import { createBot } from '../bot/bot.js';
import { loadConfig } from '../config/index.js';
import { createPool } from '../db/pool.js';
import { issueSessionToken } from '../modules/identity/index.js';
import { createLogger } from '../observability/logger.js';
import { createRequireBusiness } from './auth.js';
import { buildServer } from './server.js';

const SESSION_SECRET = 's'.repeat(32);
const config = loadConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  DATABASE_URL: TEST_APP_URL,
  TELEGRAM_BOT_TOKEN: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
  TELEGRAM_WEBHOOK_SECRET: 'test_webhook_secret_1234567890',
  SESSION_SECRET,
});

let pool: Pool;
let app: ReturnType<typeof buildServer>;
beforeAll(async () => {
  pool = createPool(TEST_APP_URL, { max: 4 });
  const logger = createLogger(config, new Writable({ write: (_c, _e, cb) => cb() }));
  const bot = createBot({
    config,
    logger,
    pool,
    handlers: false,
    botInfo: { id: 1, is_bot: true, first_name: 'T', username: 'kissauzbot' } as UserFromGetMe,
  });
  app = buildServer({ config, logger, pool, bot });
  const requireBusiness = createRequireBusiness({ config, pool });
  // Faqat test uchun himoyalangan route'lar
  app.get('/api/_t/any', { preHandler: requireBusiness() }, (req) => ({ access: req.access }));
  app.get('/api/_t/staff-manage', { preHandler: requireBusiness('staff.manage') }, () => ({
    ok: true,
  }));
  app.get('/api/_t/delete-entry', { preHandler: requireBusiness('ledger.entry.delete') }, () => ({
    ok: true,
  }));
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

const token = (userId: string) =>
  issueSessionToken(userId, { secret: SESSION_SECRET, ttlSeconds: 600 }).token;
const get = (url: string, userId: string, businessId?: string) =>
  app.inject({
    method: 'GET',
    url,
    headers: {
      authorization: `Bearer ${token(userId)}`,
      ...(businessId ? { 'x-business-id': businessId } : {}),
    },
  });

describe('HTTP: requireBusiness (server-side authorization)', () => {
  it('tokensiz 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/_t/any' })).statusCode).toBe(401);
  });

  it('biznesi yo‘q foydalanuvchi: 409 BUSINESS_REQUIRED', async () => {
    const u = await fx.createUser(pool);
    const res = await get('/api/_t/any', u);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('BUSINESS_REQUIRED');
  });

  it('OWNER hamma permission, STAFF cheklangan', async () => {
    const owner = await fx.createUser(pool);
    const staff = await fx.createUser(pool);
    const biz = await fx.createBusiness(pool, owner);
    await fx.addMember(pool, biz, owner, staff);

    expect((await get('/api/_t/staff-manage', owner)).statusCode).toBe(200);
    expect((await get('/api/_t/staff-manage', staff)).statusCode).toBe(403);
    expect((await get('/api/_t/delete-entry', staff)).statusCode).toBe(200);
    const any = await get('/api/_t/any', staff);
    expect(any.json().access).toEqual({ userId: staff, businessId: biz, role: 'STAFF' });
  });

  it('AC-06: klient X-Business-Id bilan boshqa biznesga o‘tib bo‘lmaydi (403, mavjud bo‘lmaganidan farqsiz)', async () => {
    const a = await fx.createUser(pool);
    const b = await fx.createUser(pool);
    await fx.createBusiness(pool, a);
    const bizB = await fx.createBusiness(pool, b);
    const foreign = await get('/api/_t/any', a, bizB);
    const missing = await get('/api/_t/any', a, '00000000-0000-4000-8000-000000000000');
    expect(foreign.statusCode).toBe(403);
    expect(missing.statusCode).toBe(403);
    expect(foreign.json()).toEqual(missing.json());
  });

  it('revoke qilingan xodim tokeni hali amal qilsa ham darhol 403/409 oladi', async () => {
    const owner = await fx.createUser(pool);
    const staff = await fx.createUser(pool);
    const biz = await fx.createBusiness(pool, owner);
    await fx.addMember(pool, biz, owner, staff);
    expect((await get('/api/_t/any', staff, biz)).statusCode).toBe(200);
    await fx.revokeMember(pool, biz, owner, staff);
    expect((await get('/api/_t/any', staff, biz)).statusCode).toBe(403);
    expect((await get('/api/_t/any', staff)).statusCode).toBe(409);
  });

  it('klient yuborgan rol/user_id e’tiborsiz (header orqali o‘zini OWNER qilib bo‘lmaydi)', async () => {
    const owner = await fx.createUser(pool);
    const staff = await fx.createUser(pool);
    const biz = await fx.createBusiness(pool, owner);
    await fx.addMember(pool, biz, owner, staff);
    const res = await app.inject({
      method: 'GET',
      url: '/api/_t/staff-manage?role=OWNER&user_id=' + owner,
      headers: { authorization: `Bearer ${token(staff)}`, 'x-role': 'OWNER', 'x-user-id': owner },
    });
    expect(res.statusCode).toBe(403);
  });

  it('/api/me foydalanuvchi a’zoliklarini qaytaradi', async () => {
    const u = await fx.createUser(pool);
    const biz = await fx.createBusiness(pool, u, 'Mening do‘konim');
    const res = await get('/api/me', u);
    expect(res.json().businesses).toEqual([{ id: biz, name: 'Mening do‘konim', role: 'OWNER' }]);
  });
});
