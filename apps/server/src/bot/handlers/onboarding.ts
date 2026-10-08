import { subscriptionRequestUrl } from '@nasiya/shared';
import { InlineKeyboard, type Bot } from 'grammy';
import type { Pool } from 'pg';
import type { Config } from '../../config/index.js';
import { withTenant } from '../../db/tenant.js';
import {
  BusinessRequiredError,
  ConflictError,
  ForbiddenError,
  ValidationError,
} from '../../errors/index.js';
import { isLocale, t, type MessageKey } from '../../i18n/index.js';
import { subscriptionStatus, type SubscriptionStatus } from '../../modules/billing/status.js';
import { clearState, getState, setState } from '../../modules/conversation/state.js';
import { setLocale, type Locale } from '../../modules/identity/index.js';
import {
  createBusinessWithOwner,
  createInvite,
  getBusinessSettings,
  listMemberships,
  redeemInvite,
  resolveBusinessAccess,
  setActiveBusiness,
  type BusinessAccess,
} from '../../modules/tenancy/index.js';
import type { Logger } from '../../observability/logger.js';
import type { BotContext } from '../bot.js';
import { mainKeyboard } from '../ui/keyboards.js';

export const STATE_AWAIT_BUSINESS_NAME = 'ONBOARDING_AWAIT_BUSINESS_NAME';
const TIMEZONE = 'Asia/Tashkent';

export interface HandlerDeps {
  readonly config: Pick<Config, 'telegram' | 'billing'>;
  readonly pool: Pool;
  readonly logger: Logger;
  readonly botUsername: () => string;
}

/** dd.MM.yyyy, Toshkent vaqti bo'yicha. */
export function formatDate(date: Date, timeZone = TIMEZONE): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
    .format(date)
    .replaceAll('/', '.');
}

export function describeStatus(ctx: BotContext, status: SubscriptionStatus): string {
  const date = formatDate(status.until);
  if (status.state === 'TRIAL') return ctx.t('status.trial', { date, days: status.daysLeft });
  if (status.state === 'ACTIVE') return ctx.t('status.active', { date });
  return ctx.t('status.expired');
}

const supportLine = (ctx: BotContext, deps: HandlerDeps): string =>
  deps.config.billing.supportPhone
    ? ctx.t('status.pay', { phone: deps.config.billing.supportPhone })
    : '';

/**
 * "Obunani uzaytirish" tugmasi: admin chatini ochadi, xabar biznes kodi bilan oldindan yozilgan.
 * Admin raqami sozlanmagan bo'lsa tugma yo'q.
 */
export async function renewKeyboard(
  ctx: BotContext,
  deps: Pick<HandlerDeps, 'config' | 'pool'>,
  access: BusinessAccess,
): Promise<InlineKeyboard | undefined> {
  const phone = deps.config.billing.supportPhone;
  if (!phone) return undefined;
  const { shortCode } = await getBusinessSettings(deps.pool, access);
  return new InlineKeyboard().url(
    ctx.t('button.contactAdmin'),
    subscriptionRequestUrl(phone, ctx.user.locale, shortCode),
  );
}

export async function loadStatus(
  deps: HandlerDeps,
  access: BusinessAccess,
): Promise<SubscriptionStatus> {
  const { rows } = await withTenant(
    deps.pool,
    { businessId: access.businessId, userId: access.userId },
    (c) =>
      c.query<{ trial_ends_at: Date; paid_until: Date | null }>(
        'SELECT trial_ends_at, paid_until FROM subscriptions WHERE business_id = $1',
        [access.businessId],
      ),
  );
  const row = rows[0];
  // Obunasiz biznes yozishga ruxsat bermaydi
  if (!row) return subscriptionStatus({ trialEndsAt: new Date(0), paidUntil: null });
  return subscriptionStatus({ trialEndsAt: row.trial_ends_at, paidUntil: row.paid_until });
}

export const langKeyboard = (ctx: BotContext) =>
  new InlineKeyboard()
    .text(ctx.t('lang.button.latn'), 'lang:uz-Latn')
    .text(ctx.t('lang.button.cyrl'), 'lang:uz-Cyrl');

export async function businessName(deps: HandlerDeps, access: BusinessAccess): Promise<string> {
  const memberships = await listMemberships(deps.pool, access.userId);
  return memberships.find((m) => m.businessId === access.businessId)?.name ?? '';
}

export async function showMenu(
  ctx: BotContext,
  deps: HandlerDeps,
  access: BusinessAccess,
): Promise<void> {
  const [name, status] = await Promise.all([businessName(deps, access), loadStatus(deps, access)]);
  const lines = [
    ctx.t('menu.title', {
      name,
      role: ctx.t(`role.${access.role}` as MessageKey),
      status: describeStatus(ctx, status),
    }),
  ];
  if (status.state === 'EXPIRED') lines.push(supportLine(ctx, deps));
  if (access.role === 'OWNER') lines.push(ctx.t('menu.invite'));
  // Pastki klaviatura shu xabar bilan o'rnatiladi (Mini App chat menyu tugmasida)
  await ctx.reply(`${lines.filter(Boolean).join('\n')}\n\n${ctx.t('menu.hint')}`, {
    reply_markup: mainKeyboard(ctx),
  });
}

/** Foydalanuvchining bizneslari ro'yxati (tanlash tugmalari bilan). */
export async function sendBusinessChooser(ctx: BotContext, deps: HandlerDeps): Promise<void> {
  const memberships = await listMemberships(deps.pool, ctx.user.id);
  const keyboard = new InlineKeyboard();
  for (const m of memberships) keyboard.text(m.name, `biz:${m.businessId}`).row();
  await ctx.reply(ctx.t('start.choose'), { reply_markup: keyboard });
}

/** Xodim taklifi havolasini yaratadi va yuboradi (faqat egasi). */
export async function sendInvite(
  ctx: BotContext,
  deps: HandlerDeps,
  access: BusinessAccess,
): Promise<void> {
  try {
    const invite = await createInvite(deps.pool, access);
    const link = `https://t.me/${deps.botUsername()}?start=inv_${invite.token}`;
    await ctx.reply(ctx.t('invite.created', { link }), {
      link_preview_options: { is_disabled: true },
    });
  } catch (error) {
    if (error instanceof ForbiddenError) return void (await ctx.reply(ctx.t('error.forbidden')));
    if (error instanceof ConflictError) return void (await ctx.reply(ctx.t('error.generic')));
    throw error;
  }
}

/** Foydalanuvchi uchun "uy" ekrani: biznes bo'lmasa onboarding, bir nechta bo'lsa tanlash, aks holda menyu. */
export async function showHome(ctx: BotContext, deps: HandlerDeps): Promise<void> {
  try {
    const access = await resolveBusinessAccess(deps.pool, ctx.user);
    await showMenu(ctx, deps, access);
  } catch (error) {
    if (!(error instanceof BusinessRequiredError)) throw error;
    if (error.details['reason'] === 'NO_MEMBERSHIP') {
      await ctx.reply(ctx.t('welcome.new'), { reply_markup: langKeyboard(ctx) });
      return;
    }
    await sendBusinessChooser(ctx, deps);
  }
}

async function handleInvite(ctx: BotContext, deps: HandlerDeps, token: string): Promise<void> {
  const result = await redeemInvite(deps.pool, ctx.user.id, token);
  if (!result) {
    await ctx.reply(ctx.t('invite.invalid'));
    return;
  }
  await ctx.reply(ctx.t('invite.joined', { name: result.businessName }));
  if (result.joined) {
    // Egasiga xabar: best-effort, xato asosiy oqimni buzmasin
    const who = ctx.user.firstName ?? ctx.user.username ?? String(ctx.user.telegramUserId);
    const ownerLocale = await ownerLocaleOf(deps, result.ownerTelegramId);
    await ctx.api
      .sendMessage(
        result.ownerTelegramId,
        t(ownerLocale, 'invite.ownerNotice', { user: who, business: result.businessName }),
      )
      .catch((error: unknown) => deps.logger.warn({ err: error }, 'egasiga xabar yuborilmadi'));
  }
  const access = await resolveBusinessAccess(deps.pool, ctx.user, result.businessId);
  await showMenu(ctx, deps, access);
}

async function ownerLocaleOf(deps: HandlerDeps, telegramId: number): Promise<Locale> {
  const { rows } = await deps.pool.query<{ locale: Locale }>(
    'SELECT locale FROM users WHERE telegram_user_id = $1',
    [telegramId],
  );
  return rows[0]?.locale ?? 'uz-Latn';
}

export function registerOnboarding(bot: Bot<BotContext>, deps: HandlerDeps): void {
  const { pool } = deps;

  bot.command('start', async (ctx) => {
    await clearState(pool, ctx.user.id);
    const payload = ctx.match.trim();
    if (payload.startsWith('inv_')) return handleInvite(ctx, deps, payload.slice('inv_'.length));
    return showHome(ctx, deps);
  });

  bot.command('menu', async (ctx) => {
    await clearState(pool, ctx.user.id);
    return showHome(ctx, deps);
  });

  bot.command('app', (ctx) => {
    const url = deps.config.telegram.miniAppUrl;
    if (!url) return ctx.reply(ctx.t('menu.noApp'));
    return ctx.reply(ctx.t('menu.openApp'), {
      reply_markup: new InlineKeyboard().webApp(ctx.t('menu.openApp'), url),
    });
  });

  bot.callbackQuery(/^lang:(uz-Latn|uz-Cyrl)$/, async (ctx) => {
    const locale = ctx.match[1]!;
    if (!isLocale(locale)) return;
    await ctx.answerCallbackQuery();
    await setLocale(pool, ctx.user.id, locale);
    ctx.user = { ...ctx.user, locale };
    await ctx.editMessageReplyMarkup().catch(() => undefined);

    const memberships = await listMemberships(pool, ctx.user.id);
    if (memberships.length === 0) {
      await ctx.reply(ctx.t('lang.chosen'));
      await setState(pool, ctx.user.id, STATE_AWAIT_BUSINESS_NAME);
      await ctx.reply(ctx.t('onboarding.askName'));
      return;
    }
    // Pastki klaviatura yangi tilda qayta o'rnatiladi
    await ctx.reply(ctx.t('lang.chosen'), { reply_markup: mainKeyboard(ctx) });
  });

  bot.callbackQuery(/^biz:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    // businessId faqat selector: a'zolik serverda tekshiriladi
    try {
      const access = await setActiveBusiness(pool, ctx.user.id, ctx.match[1]!);
      await ctx.editMessageReplyMarkup().catch(() => undefined);
      await showMenu(ctx, deps, access);
    } catch (error) {
      if (!(error instanceof ForbiddenError || error instanceof ValidationError)) throw error;
      await ctx.reply(ctx.t('error.forbidden'));
    }
  });

  bot.command('invite', async (ctx) => {
    let access: BusinessAccess;
    try {
      access = await resolveBusinessAccess(pool, ctx.user);
    } catch (error) {
      if (error instanceof BusinessRequiredError) return ctx.reply(ctx.t('error.noBusiness'));
      throw error;
    }
    await sendInvite(ctx, deps, access);
  });

  // Biznes nomini kutish holati
  bot.on('message:text', async (ctx, next) => {
    const state = await getState(pool, ctx.user.id);
    // Buyruqlar (/help, /til...) nom sifatida olinmaydi: o'z handleriga o'tadi, holat saqlanadi
    if (state?.state !== STATE_AWAIT_BUSINESS_NAME || ctx.message.text.startsWith('/'))
      return next();

    try {
      const created = await createBusinessWithOwner(pool, ctx.user.id, ctx.message.text, {
        trialDays: deps.config.billing.trialDays,
      });
      await clearState(pool, ctx.user.id);
      if (created.trialGranted) {
        await ctx.reply(
          ctx.t('onboarding.created', {
            name: created.name,
            days: deps.config.billing.trialDays,
            date: formatDate(created.trialEndsAt),
          }),
          { reply_markup: mainKeyboard(ctx) },
        );
      } else {
        await ctx.reply(
          ctx.t('onboarding.createdNoTrial', {
            name: created.name,
            support: supportLine(ctx, deps),
          }),
          { reply_markup: mainKeyboard(ctx) },
        );
      }
    } catch (error) {
      if (error instanceof ValidationError) return ctx.reply(ctx.t('onboarding.nameInvalid'));
      if (error instanceof ConflictError) {
        await clearState(pool, ctx.user.id);
        return ctx.reply(ctx.t('onboarding.limit', { max: error.details['max'] as number }));
      }
      throw error;
    }
  });
}
