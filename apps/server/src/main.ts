import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as Sentry from '@sentry/node';
import { ALLOWED_UPDATES, createBot, registerFallback } from './bot/bot.js';
import { loadConfig, redactConfig } from './config/index.js';
import { createPool } from './db/pool.js';
import { buildServer } from './http/server.js';
import { createLogger } from './observability/logger.js';
import { initSentry } from './observability/sentry.js';
import { createGeminiGenerate, createGeminiProvider } from './modules/interpretation/gemini.js';
import { scheduleMaintenance } from './modules/maintenance/jobs.js';
import { DailyBudget } from './util/resilience.js';

const config = loadConfig(process.env);
const logger = createLogger(config);
initSentry(config);
logger.info({ config: redactConfig(config) }, 'konfiguratsiya yuklandi');

const pool = createPool(config.db.url, {
  onError: (error) => logger.error({ err: error }, 'pg pool xatosi'),
});
const gemini = config.ai.gemini;
const bot = createBot({
  config,
  logger,
  pool,
  ai: gemini
    ? {
        provider: createGeminiProvider({
          generate: createGeminiGenerate(gemini.apiKey, gemini.model),
          model: gemini.model,
          timeoutMs: gemini.timeoutMs,
        }),
        budget: new DailyBudget(gemini.dailyLimit),
        mode: gemini.mode,
      }
    : undefined,
});
logger.info(
  { llm: gemini ? { model: gemini.model, mode: gemini.mode } : 'off' },
  'interpretatsiya rejimi',
);
await bot.init();
registerFallback(bot);
// Mini App build'i: dev (src/) va production (dist/) joylashuvidan topiladi
const miniAppDir = ['../../miniapp/dist', '../../../miniapp/dist']
  .map((p) => fileURLToPath(new URL(p, import.meta.url)))
  .find((p) => existsSync(p));
if (!miniAppDir)
  logger.warn(
    'Mini App build topilmadi (apps/miniapp/dist): /app/ o‘chirilgan. `pnpm build:miniapp`',
  );
const app = buildServer({ config, logger, pool, bot, miniAppDir });

await app.listen({ host: config.http.host, port: config.http.port });

// Cross-tenant xizmat vazifalari (retention, muddati o'tgan qoralamalar, balans reconciliation): nasiya_system pool
const systemPool = config.db.systemUrl
  ? createPool(config.db.systemUrl, {
      max: 2,
      applicationName: 'nasiya-system',
      onError: (error) => logger.error({ err: error }, 'pg system pool xatosi'),
    })
  : undefined;
const stopMaintenance = systemPool ? scheduleMaintenance(systemPool, logger) : undefined;
if (!systemPool)
  logger.warn(
    'SYSTEM_DATABASE_URL berilmagan: xizmat vazifalari (retention, reconciliation) ishlamaydi',
  );

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
    stopMaintenance?.();
    await app.close();
    await pool.end();
    await systemPool?.end();
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
