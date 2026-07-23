import { Bot, session, GrammyError, HttpError } from 'grammy';
import { conversations, createConversation } from '@grammyjs/conversations';

import { config } from './lib/config.js';
import { sessions } from './lib/sessions.js';
import { t } from './lib/i18n.js';

import { handleStart, handleContact } from './handlers/auth.js';
import {
  handleDebtors,
  handleDashboard,
  handleLangMenu,
  handleLangCallback,
  handleHistoryCallback,
} from './handlers/menu.js';

import { addDebtConversation } from './scenes/addDebt.js';
import { dailySalesConversation } from './scenes/dailySales.js';
import { registerConversation } from './scenes/register.js';
import { linkOtpConversation } from './scenes/linkOtp.js';

const bot = new Bot(config.botToken);

// grammY conversations need a session (in-memory here; persistence via our own store)
bot.use(session({ initial: () => ({}) }));
bot.use(conversations());
bot.use(createConversation(addDebtConversation, 'addDebt'));
bot.use(createConversation(dailySalesConversation, 'dailySales'));
bot.use(createConversation(registerConversation, 'register'));
bot.use(createConversation(linkOtpConversation, 'linkOtp'));

// ---- Commands ----
bot.command('start', handleStart);
bot.command('register', (ctx) => ctx.conversation.enter('register'));
bot.command('cancel', async (ctx) => {
  const lang = sessions.get(ctx.from.id)?.lang || 'uz';
  await ctx.reply(t('cancelled', lang));
});
bot.command('menu', handleStart);

// ---- Contact (phone auth) ----
bot.on('message:contact', handleContact);

// ---- Callback queries ----
bot.callbackQuery(/^lang:/, handleLangCallback);
bot.callbackQuery(/^history:/, handleHistoryCallback);
bot.callbackQuery(/^adddebt:/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.conversation.enter('addDebt');
});

// ---- Menu buttons (text in either language) ----
const menuKeys = {
  addDebt: ['menu_add_debt'],
  debtors: ['menu_debtors'],
  dashboard: ['menu_dashboard'],
  dailySales: ['menu_daily_sales'],
  lang: ['menu_lang'],
};
const matches = (text, key) =>
  ['uz', 'ru'].some((l) => t(key, l) === text);

bot.on('message:text', async (ctx, next) => {
  const text = ctx.message.text;
  if (matches(text, 'menu_add_debt')) return ctx.conversation.enter('addDebt');
  if (matches(text, 'menu_debtors')) return handleDebtors(ctx);
  if (matches(text, 'menu_dashboard')) return handleDashboard(ctx);
  if (matches(text, 'menu_daily_sales')) return ctx.conversation.enter('dailySales');
  if (matches(text, 'menu_lang')) return handleLangMenu(ctx);
  return next();
});

// fallback for unauthed / unknown text
bot.on('message:text', async (ctx) => {
  const tgId = ctx.from.id;
  const lang = sessions.get(tgId)?.lang || 'uz';
  if (!sessions.isAuthed(tgId)) return handleStart(ctx);
  await ctx.reply(t('menu_title', lang));
});

// ---- Error handling ----
bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`[bot] Error for update ${ctx?.update?.update_id}:`);
  const e = err.error;
  if (e instanceof GrammyError) console.error('Telegram error:', e.description);
  else if (e instanceof HttpError) console.error('HTTP error:', e);
  else console.error('Unknown error:', e);
});

// ---- Startup ----
const start = async () => {
  if (!config.botToken) {
    console.error('[bot] Cannot start: TELEGRAM_BOT_TOKEN is missing.');
    process.exit(1);
  }
  await bot.api.setMyCommands([
    { command: 'start', description: 'Botni ishga tushirish / Запуск' },
    { command: 'menu', description: 'Asosiy menyu / Меню' },
    { command: 'register', description: 'Ro\'yxatdan o\'tish / Регистрация' },
    { command: 'cancel', description: 'Bekor qilish / Отмена' },
  ]);

  if (config.useWebhook && config.webhookUrl) {
    const { webhookCallback } = await import('grammy');
    const express = (await import('express')).default;
    const app = express();
    app.use(express.json());
    app.use(webhookCallback(bot, 'express'));
    app.listen(config.port, () => console.log(`[bot] Webhook server on :${config.port}`));
    await bot.api.setWebhook(config.webhookUrl);
    console.log('[bot] Webhook set:', config.webhookUrl);
  } else {
    console.log('[bot] Starting long polling...');
    bot.start({ onStart: (i) => console.log(`[bot] @${i.username} running ✔`) });
  }
};

start();
