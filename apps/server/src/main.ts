import * as Sentry from '@sentry/node';
import { ALLOWED_UPDATES, createBot } from './bot/bot.js';
import { loadConfig, redactConfig } from './config/index.js';
import { createPool } from './db/pool.js';
import { buildServer } from './http/server.js';
import { createLogger } from './observability/logger.js';
import { initSentry } from './observability/sentry.js';

const config = loadConfig(process.env);
const logger = createLogger(config);
initSentry(config);
logger.info({ config: redactConfig(config) }, 'konfiguratsiya yuklandi');

const pool = createPool(config.db.url, {
  onError: (error) => logger.error({ err: error }, 'pg pool xatosi'),
});
const bot = createBot({ config, logger, pool });
await bot.init();
const app = buildServer({ config, logger, pool, bot });

await app.listen({ host: config.http.host, port: config.http.port });

if (config.telegram.mode === 'polling') {
  // Dev: webhook bo'lsa polling ishlamaydi, shuning uchun o'chiriladi.
  await bot.api.deleteWebhook();
  void bot.start({
    allowed_updates: [...ALLOWED_UPDATES],
    onStart: (me) => logger.info({ bot: me.username }, 'polling boshlandi'),
  });
}

let shuttingDown = false;
async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'to‘xtatilmoqda');
  const force = setTimeout(() => process.exit(1), 15_000);
  force.unref();
  try {
    if (config.telegram.mode === 'polling') await bot.stop();
    await app.close();
    await pool.end();
    await Sentry.flush(2000);
  } catch (error) {
    logger.error({ err: error }, 'to‘xtatishda xatolik');
    exitCode = 1;
  }
  process.exit(exitCode);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandledRejection');
  Sentry.captureException(reason);
  void shutdown('unhandledRejection', 1);
});
