import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as Sentry from '@sentry/node';
import { ALLOWED_UPDATES, createBot, registerFallback } from './bot/bot.js';
import { ADMIN_COMMANDS } from './bot/handlers/admin.js';
import { BOT_COMMANDS } from './bot/handlers/menu.js';
import { loadConfig, redactConfig } from './config/index.js';
import { createPool } from './db/pool.js';
import { buildServer } from './http/server.js';
import { createLogger } from './observability/logger.js';
import { initSentry } from './observability/sentry.js';
import { BroadcastSender } from './modules/admin/broadcast.js';
import { scheduleReminders } from './modules/billing/reminders.js';
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
// Cross-tenant xizmat vazifalari (retention, muddati o'tgan qoralamalar, balans reconciliation): nasiya_system pool
const systemPool = config.db.systemUrl
  ? createPool(config.db.systemUrl, {
      max: 2,
      applicationName: 'nasiya-system',
      onError: (error) => logger.error({ err: error }, 'pg system pool xatosi'),
    })
  : undefined;
const gemini = config.ai.gemini;
const bot = createBot({
  config,
  logger,
  pool,
  sys: systemPool,
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
// "/" menyusi: Mini App bo'lmasa /app ko'rsatilmaydi
await bot.api
  .setMyCommands(
    BOT_COMMANDS.filter((c) => c.command !== 'app' || config.telegram.miniAppUrl).map((c) => ({
      ...c,
    })),
  )
  .catch((error: unknown) => logger.warn({ err: error }, 'buyruqlar ro‘yxati o‘rnatilmadi'));
// Superadminlarga o'z chatida admin buyruqlari ham ko'rinadi
if (systemPool) {
  for (const chatId of config.billing.superadminTelegramIds) {
    await bot.api
      .setMyCommands(
        [...BOT_COMMANDS, ...ADMIN_COMMANDS].map((c) => ({ ...c })),
        { scope: { type: 'chat', chat_id: chatId } },
      )
      .catch((error: unknown) => logger.warn({ err: error }, 'admin buyruqlari o‘rnatilmadi'));
  }
}
if (config.telegram.miniAppUrl) {
  // Chat pastidagi menyu tugmasi Mini App'ni ochadi (hamma foydalanuvchi uchun)
  await bot.api
    .setChatMenuButton({
      menu_button: {
        type: 'web_app',
        text: '📱 Ilova',
        web_app: { url: config.telegram.miniAppUrl },
      },
    })
    .catch((error: unknown) => logger.warn({ err: error }, 'menyu tugmasi o‘rnatilmadi'));
}
// Mini App build'i: dev (src/) va production (dist/) joylashuvidan topiladi
const miniAppDir = ['../../miniapp/dist', '../../../miniapp/dist']
  .map((p) => fileURLToPath(new URL(p, import.meta.url)))
  .find((p) => existsSync(p));
if (!miniAppDir)
  logger.warn(
    'Mini App build topilmadi (apps/miniapp/dist): /app/ o‘chirilgan. `pnpm build:miniapp`',
  );
// Superadmin paneli va broadcast yuboruvchi ham shu pool bilan (BYPASSRLS)
const broadcasts = systemPool
  ? new BroadcastSender({
      sys: systemPool,
      logger,
      send: (chatId, text) => bot.api.sendMessage(chatId, text),
    })
  : undefined;
const app = buildServer({
  config,
  logger,
  pool,
  bot,
  miniAppDir,
  admin: systemPool && broadcasts ? { sys: systemPool, broadcasts } : undefined,
});

await app.listen({ host: config.http.host, port: config.http.port });

const stopMaintenance = systemPool ? scheduleMaintenance(systemPool, logger) : undefined;
// Obuna eslatmalari: 3 kun, 1 kun qolganda va tugagan kuni (09:00–21:00)
const stopReminders = systemPool
  ? scheduleReminders({
      sys: systemPool,
      logger,
      supportPhone: config.billing.supportPhone,
      send: (chatId, text, button) =>
        bot.api.sendMessage(
          chatId,
          text,
          button
            ? { reply_markup: { inline_keyboard: [[{ text: button.text, url: button.url }]] } }
            : {},
        ),
    })
  : undefined;
// Jarayon to'xtagan paytda yuborilmay qolgan broadcast xabarlari davom ettiriladi
void broadcasts?.kick().catch((error: unknown) => logger.error({ err: error }, 'broadcast xatosi'));
if (!systemPool)
  logger.warn('SYSTEM_DATABASE_URL berilmagan: xizmat vazifalari va superadmin paneli ishlamaydi');

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
    stopReminders?.();
    broadcasts?.stop();
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
