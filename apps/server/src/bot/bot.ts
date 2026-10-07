import { Bot, type Context } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import type { Pool } from 'pg';
import type { Config } from '../config/index.js';
import { t as translate, type MessageKey, type Params } from '../i18n/index.js';
import { upsertTelegramUser, type User } from '../modules/identity/index.js';
import { reportError } from '../observability/sentry.js';
import { runWithContext, setContext } from '../observability/context.js';
import type { Logger } from '../observability/logger.js';
import { KeyedMutex } from '../util/keyed-mutex.js';
import { registerOnboarding } from './handlers/onboarding.js';

/** Faqat kerakli update turlari (ADR-0006 §1). */
export const ALLOWED_UPDATES = ['message', 'callback_query', 'my_chat_member'] as const;

/** `user` identity middleware tomonidan har bir (private) update uchun o'rnatiladi. */
export type BotContext = Context & {
  user: User;
  /** Foydalanuvchi tilida matn (locale o'zgarsa darhol hisobga olinadi). */
  t: (key: MessageKey, params?: Params) => string;
};

export interface BotDeps {
  readonly config: Pick<Config, 'telegram' | 'billing'>;
  readonly logger: Logger;
  readonly pool: Pool;
  /** Berilsa `bot.init()` (getMe) chaqirilmaydi: testlar va tez ishga tushirish uchun. */
  readonly botInfo?: UserFromGetMe;
}

/**
 * Hamma update uchun umumiy qatlam (handlerlar undan keyin ro'yxatdan o'tadi):
 *  1. log konteksti (updateId)
 *  2. xato chegarasi: foydalanuvchiga umumiy xabar, tafsilot loglarda (matnsiz)
 *  3. faqat private chat
 *  4. bir chat ichida ketma-ket ishlov (kelish tartibida)
 *  5. update dedupe (processed_updates, best-effort — moliyaviy kafolat emas, ADR-0003)
 *  6. identity: Telegram `from` bo'yicha foydalanuvchi (ctx.user); botlar e'tiborsiz
 */
export function createBot(deps: BotDeps): Bot<BotContext> {
  const { logger, pool } = deps;
  const bot = new Bot<BotContext>(
    deps.config.telegram.botToken,
    deps.botInfo ? { botInfo: deps.botInfo } : undefined,
  );
  const mutex = new KeyedMutex();

  bot.use((ctx, next) => runWithContext({ updateId: ctx.update.update_id }, () => next()));

  // Xato chegarasi: foydalanuvchiga umumiy xabar, tafsilot faqat loglarda (matnsiz).
  bot.use(async (ctx, next) => {
    try {
      await next();
    } catch (error) {
      logger.error({ err: error }, 'update ishlovida xatolik');
      reportError(error);
      try {
        // ctx.t identity qatlamidan oldin xato bo'lsa mavjud emas: Lotin matniga tushamiz
        await ctx.reply(translate(ctx.user?.locale ?? 'uz-Latn', 'error.generic'));
      } catch (replyError) {
        logger.warn({ err: replyError }, 'xato haqida xabar yuborib bo‘lmadi');
      }
    }
  });

  bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== 'private') {
      logger.debug({ chatType: ctx.chat?.type }, 'private bo‘lmagan update e‘tiborsiz qoldirildi');
      return;
    }
    await next();
  });

  // Navbatga kirish sinxron: update'lar chatga kelish tartibida ishlanadi (dedupe'dan oldin).
  bot.use((ctx, next) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return next();
    return mutex.run(String(chatId), () => next());
  });

  bot.use(async (ctx, next) => {
    const { rowCount } = await pool.query(
      'INSERT INTO processed_updates (update_id) VALUES ($1) ON CONFLICT DO NOTHING',
      [ctx.update.update_id],
    );
    if (rowCount === 0) {
      logger.info('takroriy update o‘tkazib yuborildi');
      return;
    }
    await next();
  });

  bot.use(async (ctx, next) => {
    const from = ctx.from;
    if (!from || from.is_bot) return;
    ctx.user = await upsertTelegramUser(pool, from);
    ctx.t = (key, params) => translate(ctx.user.locale, key, params);
    setContext({ userId: ctx.user.id });
    await next();
  });

  // `handleUpdate` xatoni bot.catch ga emas, chaqiruvchiga qaytaradi, shuning uchun chegara middleware sifatida.
  bot.catch(({ error }) => logger.error({ err: error }, 'bot.catch: kutilmagan xato'));

  registerOnboarding(bot, {
    config: deps.config,
    pool,
    logger,
    botUsername: () => bot.botInfo.username,
  });

  return bot;
}

/**
 * Eng oxirgi handler: boshqa hech kim ushlamagan matn. Hozircha tabiiy matn tahlili yo'q
 * (Phase 3, interpretatsiya shu o'rinni egallaydi). Testlar o'z handlerlarini avval ro'yxatdan o'tkazadi.
 */
export function registerFallback(bot: Bot<BotContext>): void {
  bot.on('message:text', (ctx) => ctx.reply(ctx.t('fallback.unknown')));
}
