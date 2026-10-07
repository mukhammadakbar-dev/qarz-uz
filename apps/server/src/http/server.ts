import { createHash, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import type { Bot } from 'grammy';
import type { Update } from 'grammy/types';
import type { Pool } from 'pg';
import type { BotContext } from '../bot/bot.js';
import type { Config } from '../config/index.js';
import { toPublicError } from '../errors/index.js';
import { runWithContext } from '../observability/context.js';
import type { Logger } from '../observability/logger.js';
import { reportError } from '../observability/sentry.js';
import { registerAuthRoutes } from './auth.js';

export const WEBHOOK_PATH = '/telegram/webhook';
const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

export interface ServerDeps {
  readonly config: Pick<Config, 'telegram' | 'session'>;
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

export function buildServer(deps: ServerDeps) {
  const { config, logger, pool, bot } = deps;
  const app = Fastify({
    loggerInstance: logger,
    bodyLimit: 256 * 1024,
    trustProxy: true,
    requestIdHeader: false,
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
    }
    return reply
      .status(finalStatus)
      .send(
        finalStatus >= 500 ? body : { code: body.code === 'INTERNAL' ? 'BAD_REQUEST' : body.code },
      );
  });

  app.get('/healthz', () => ({ status: 'ok' }));

  app.get('/readyz', async (_request, reply) => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ready' };
    } catch (error) {
      logger.error({ err: error }, 'DB tayyor emas');
      return reply.status(503).send({ status: 'db_unavailable' });
    }
  });

  app.post(WEBHOOK_PATH, async (request, reply) => {
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

  registerAuthRoutes(app, { config, pool });

  return app;
}
