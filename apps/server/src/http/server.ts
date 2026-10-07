import { createHash, timingSafeEqual } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import type { Bot } from 'grammy';
import type { Update } from 'grammy/types';
import type { Pool } from 'pg';
import type { BotContext } from '../bot/bot.js';
import type { Config } from '../config/index.js';
import { RateLimitedError, toPublicError } from '../errors/index.js';
import { runWithContext } from '../observability/context.js';
import type { Logger } from '../observability/logger.js';
import { reportError } from '../observability/sentry.js';
import { registerApi } from '../api/routes.js';
import { registerAuthRoutes } from './auth.js';

export const WEBHOOK_PATH = '/telegram/webhook';
const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

export interface ServerDeps {
  readonly config: Pick<Config, 'telegram' | 'session' | 'billing' | 'api'>;
  readonly logger: Logger;
  readonly pool: Pool;
  readonly bot: Bot<BotContext>;
}

/** Doimiy vaqtli taqqoslash: uzunlik farqi ham ma'lumot bermasligi uchun avval hash qilinadi. */
export function secretsEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export interface RegisteredRoute {
  readonly method: string;
  readonly url: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Barcha ro'yxatdan o'tgan yo'llar (tenant isolation matritsasi testi uchun). */
    registeredRoutes: RegisteredRoute[];
  }
}

export function buildServer(deps: ServerDeps) {
  const { config, logger, pool, bot } = deps;
  const app = Fastify({
    loggerInstance: logger,
    bodyLimit: 256 * 1024,
    trustProxy: true,
    requestIdHeader: false,
  });

  const registeredRoutes: RegisteredRoute[] = [];
  app.decorate('registeredRoutes', registeredRoutes);
  app.addHook('onRoute', (route) => {
    for (const method of [route.method].flat())
      registeredRoutes.push({ method: String(method), url: route.url });
  });

  app.addHook('onRequest', (request, _reply, done) => {
    runWithContext({ requestId: request.id }, done);
  });

  app.setErrorHandler((error, request, reply) => {
    const { status, body } = toPublicError(error);
    // Fastify'ning o'z xatolari (masalan, juda katta tana) 4xx statusga ega
    const fastifyStatus = (error as { statusCode?: number }).statusCode;
    const finalStatus =
      status === 500 && fastifyStatus && fastifyStatus < 500 ? fastifyStatus : status;
    if (finalStatus >= 500) {
      request.log.error({ err: error }, 'so‘rov xatosi');
      reportError(error);
      return reply.status(finalStatus).send(body);
    }
    // Kutilgan (domen) xatolar klientga to'liq ko'rinishda (code, message, details); boshqalari umumiy
    return reply
      .status(finalStatus)
      .send(body.code === 'INTERNAL' ? { code: 'BAD_REQUEST' } : body);
  });

  // Xavfsizlik sarlavhalari, CORS va tezlik cheklovi: yo'llardan OLDIN ro'yxatdan o'tadi
  void app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        // Telegram Web Mini App'ni iframe ichida ochadi (X-Frame-Options o'rniga)
        frameAncestors: ["'self'", 'https://web.telegram.org', 'https://*.telegram.org'],
      },
    },
    frameguard: false,
    hsts: false, // HSTS ni nginx beradi
    crossOriginEmbedderPolicy: false,
  });
  void app.register(cors, {
    origin: [...config.api.corsOrigins],
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type', 'idempotency-key', 'x-business-id'],
    exposedHeaders: ['idempotent-replayed'],
    maxAge: 600,
  });
  void app.register(rateLimit, {
    global: true,
    max: config.api.rateLimitPerMinute,
    timeWindow: '1 minute',
    // Foydalanuvchi tokeni bo'yicha (NAT ortidagi ko'p foydalanuvchi bir-birini to'smasligi uchun), aks holda IP bo'yicha
    keyGenerator: (request) => {
      const auth = request.headers.authorization;
      return auth ? `t:${createHash('sha1').update(auth).digest('hex')}` : `ip:${request.ip}`;
    },
    // Plugin qaytarilgan obyektni xato sifatida tashlaydi: umumiy xato ishlovchisi uni 429 qilib chiqaradi
    errorResponseBuilder: () =>
      new RateLimitedError('So‘rovlar juda ko‘p. Birozdan keyin urinib ko‘ring.') as unknown as {
        statusCode: number;
      },
  });

  // Yo'llar plugin ichida: rate-limit/helmet/cors ulardan oldin yuklanadi va hammasiga ta'sir qiladi
  void app.register(async (routes) => {
    routes.get('/healthz', { config: { rateLimit: false } }, () => ({ status: 'ok' }));

    routes.get('/readyz', { config: { rateLimit: false } }, async (_request, reply) => {
      try {
        await pool.query('SELECT 1');
        return { status: 'ready' };
      } catch (error) {
        logger.error({ err: error }, 'DB tayyor emas');
        return reply.status(503).send({ status: 'db_unavailable' });
      }
    });

    // Telegram serverlari IP bo'yicha cheklanmaydi (nginx allowlist + secret token himoya qiladi)
    routes.post(WEBHOOK_PATH, { config: { rateLimit: false } }, async (request, reply) => {
      const header = request.headers[SECRET_HEADER];
      if (typeof header !== 'string' || !secretsEqual(header, config.telegram.webhookSecret)) {
        request.log.warn({ ip: request.ip }, 'webhook secret mos kelmadi');
        return reply.status(401).send();
      }
      const update = request.body as Partial<Update> | null;
      if (!update || typeof update !== 'object' || !Number.isSafeInteger(update.update_id)) {
        return reply.status(400).send({ code: 'BAD_REQUEST' });
      }
      // Xatolar bot.catch ichida qayta ishlanadi; Telegram qayta yubormasligi uchun doim 200.
      await bot.handleUpdate(update as Update);
      return reply.status(200).send({ ok: true });
    });

    registerAuthRoutes(routes, { config, pool });
    registerApi(routes, {
      config,
      pool,
      logger,
      botUsername: () => bot.botInfo.username,
      send: (chatId, text) => bot.api.sendMessage(chatId, text),
    });
  });

  return app;
}
