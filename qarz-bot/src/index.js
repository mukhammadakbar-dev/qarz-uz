import { Bot, session, GrammyError, HttpError } from 'grammy';
import { conversations, createConversation } from '@grammyjs/conversations';

import { config } from './lib/config.js';
import { sessions, hydrate, flush } from './lib/sessions.js';
import { loadRemoteConfig } from './lib/remoteConfig.js';
import { captureError, flushSentry } from './instrument.js';
import { t } from './lib/i18n.js';

import { handleStart, handleContact } from './handlers/auth.js';
import {
  handleDebtors,
  handleDashboard,
  handleLangMenu,
  handleLangCallback,
  handleHistoryCallback,
  handlePayLinkCallback,
  handleReceiptSendCallback,
  handleSubscription,
} from './handlers/menu.js';

import { addDebtConversation } from './scenes/addDebt.js';
import { reduceDebtConversation } from './scenes/reduceDebt.js';
import { dailySalesConversation } from './scenes/dailySales.js';
import { registerConversation } from './scenes/register.js';
import { handleAiMessage, handleAiCallback, handleAiGuide } from './handlers/aiHandler.js';

const bot = new Bot(config.botToken);
let webServer = null;

// grammY conversations need a session (in-memory here; persistence via our own store)
bot.use(session({ initial: () => ({}) }));
bot.use(conversations());
bot.use(createConversation(addDebtConversation, 'addDebt'));
bot.use(createConversation(reduceDebtConversation, 'reduceDebt'));
bot.use(createConversation(dailySalesConversation, 'dailySales'));
bot.use(createConversation(registerConversation, 'register'));
// Auto-persist session for any Telegram user who interacts with the bot
bot.use(async (ctx, next) => {
  if (ctx.from?.id) {
    const tgId = ctx.from.id;
    if (!sessions.get(tgId)) {
      sessions.set(tgId, { lang: ctx.from.language_code === 'ru' ? 'ru' : 'uz' });
    }
  }
  return next();
});

// ---- Commands ----
bot.command('start', handleStart);
bot.command('ai', handleAiGuide);
bot.command('register', (ctx) => ctx.conversation.enter('register'));
bot.command('cancel', async (ctx) => {
  const lang = sessions.get(ctx.from.id)?.lang || 'uz';
  await ctx.conversation.exit();
  await ctx.reply(t('cancelled', lang));
});
bot.command('menu', handleStart);

// ---- Contact (phone auth) ----
bot.on('message:contact', handleContact);

// ---- Callback queries ----
bot.callbackQuery(/^lang:/, handleLangCallback);
bot.callbackQuery(/^history:/, handleHistoryCallback);
bot.callbackQuery(/^send_receipt:/, handleReceiptSendCallback);
bot.callbackQuery(/^pay_link:/, handlePayLinkCallback);
bot.callbackQuery(/^ai:/, handleAiCallback);
bot.callbackQuery(/^reg:bot$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.conversation.enter('register');
});
bot.callbackQuery(/^adddebt:/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.conversation.enter('addDebt');
});

// ---- Menu buttons (text in either language) ----
const matches = (text, key) =>
  ['uz', 'ru'].some((l) => t(key, l) === text);

bot.on('message:text', async (ctx, next) => {
  const text = ctx.message.text;
  if (matches(text, 'menu_ai')) return handleAiGuide(ctx);
  if (matches(text, 'menu_add_debt')) return ctx.conversation.enter('addDebt');
  if (matches(text, 'menu_reduce_debt')) return ctx.conversation.enter('reduceDebt');
  if (matches(text, 'menu_debtors')) return handleDebtors(ctx);
  if (matches(text, 'menu_dashboard')) return handleDashboard(ctx);
  if (matches(text, 'menu_daily_sales')) return ctx.conversation.enter('dailySales');
  if (matches(text, 'menu_subscription')) return handleSubscription(ctx);
  if (matches(text, 'menu_lang')) return handleLangMenu(ctx);
  return next();
});

// fallback for unauthed / natural language AI text
bot.on('message:text', handleAiMessage);

// ---- Error handling ----
bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`[bot] Error for update ${ctx?.update?.update_id}:`);
  const e = err.error;
  if (e instanceof GrammyError) console.error('Telegram error:', e.description);
  else if (e instanceof HttpError) console.error('HTTP error:', e);
  else console.error('Unknown error:', e);

  // Report the telegram id but never the message text — updates carry phone
  // numbers, contact cards and debt amounts.
  captureError(e instanceof Error ? e : new Error(String(e)), {
    updateId: ctx?.update?.update_id,
    telegramId: ctx?.from?.id,
    updateType: Object.keys(ctx?.update || {}).find((k) => k !== 'update_id'),
  });
});

// ---- Startup ----
const start = async () => {
  if (!config.botToken) {
    console.error('[bot] Cannot start: TELEGRAM_BOT_TOKEN is missing.');
    process.exit(1);
  }

  // Load stored sessions BEFORE any update is accepted. Serving a user off an
  // empty cache would look like a logged-out session and, worse, the next write
  // would persist that emptiness over their real tokens.
  try {
    await hydrate();
  } catch (err) {
    console.error(`[bot] Cannot start: ${err.message}`);
    console.error('[bot] Check API_BASE_URL and that the backend is running.');
    process.exit(1);
  }

  // Which payment features the backend actually has switched on. Best-effort:
  // loadRemoteConfig never throws, and its defaults hide payment buttons rather
  // than offer ones that cannot work.
  await loadRemoteConfig();

  try {
    await bot.api.setMyCommands([
      { command: 'start', description: 'Botni ishga tushirish / Запуск' },
      { command: 'ai', description: 'AI yordamchi yo\'riqnomasi / AI помощник' },
      { command: 'menu', description: 'Asosiy menyu / Меню' },
      { command: 'register', description: 'Ro\'yxatdan o\'tish / Регистрация' },
      { command: 'cancel', description: 'Bekor qilish / Отмена' },
    ]);
  } catch (err) {
    console.warn('[bot] setMyCommands muvaffaqiyatsiz (internet/Telegram vaqtincha ulanmadi):', err.message);
  }

  if (config.useWebhook && config.webhookUrl) {
    if (!config.webhookSecret) {
      console.error(
        '[bot] Cannot start: WEBHOOK_SECRET is required in webhook mode.\n' +
          '[bot] The endpoint is public, so without a secret token anyone who\n' +
          '[bot] finds the URL can POST forged updates and impersonate any user.\n' +
          '[bot] Generate one with: openssl rand -hex 32'
      );
      process.exit(1);
    }

    const { webhookCallback } = await import('grammy');
    const express = (await import('express')).default;
    const app = express();
    app.use(express.json());

    // grammY compares this against Telegram's X-Telegram-Bot-Api-Secret-Token
    // header and drops anything that doesn't match.
    app.post(
      '/telegram/webhook',
      webhookCallback(bot, 'express', { secretToken: config.webhookSecret })
    );
    app.get('/health', (_req, res) => res.json({ ok: true }));

    webServer = app.listen(config.port, () =>
      console.log(`[bot] Webhook server on :${config.port}`)
    );
    await bot.api.setWebhook(config.webhookUrl, { secret_token: config.webhookSecret });
    console.log('[bot] Webhook set:', config.webhookUrl);
  } else {
    console.log('[bot] Starting long polling...');
    // bot.start() only settles when polling stops, so it must not be awaited
    // here — but its rejection still has to be handled, or a failure to reach
    // Telegram becomes an unhandled rejection that kills the process silently.
    bot
      .start({ onStart: (i) => console.log(`[bot] @${i.username} running ✔`) })
      .catch((err) => {
        console.error('[bot] Polling stopped with an error:', err);
        process.exit(1);
      });
  }
};

// ---- Graceful shutdown ----
// grammY needs to be told to stop so the in-flight long-poll is closed and any
// update currently being handled finishes, instead of being cut mid-write.
let shuttingDown = false;
const stop = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[bot] ${signal} received, stopping...`);
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  try {
    await bot.stop();
    webServer?.close();
    // Session writes are fire-and-forget during normal operation, so drain
    // them here — otherwise a token refreshed moments before SIGTERM never
    // reaches the database and that user is logged out on the next start.
    await flush();
    // Sentry batches over the network, so a report from the error that caused
    // this shutdown is still only buffered at this point.
    await flushSentry();
  } catch (err) {
    console.error('[bot] Error during shutdown:', err);
  }
  process.exit(0);
};
process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  console.error('[bot] Unhandled promise rejection:', reason);
  captureError(reason instanceof Error ? reason : new Error(String(reason)), {
    kind: 'unhandledRejection',
  });
});

start().catch((err) => {
  console.error('[bot] Failed to start:', err);
  process.exit(1);
});
