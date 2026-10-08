import { formatUzs, subscriptionRequestUrl } from '@nasiya/shared';
import { displayName } from '@nasiya/nlp';
import { InlineKeyboard, type Bot } from 'grammy';
import { BusinessRequiredError } from '../../errors/index.js';
import type { MessageKey } from '../../i18n/index.js';
import { clearState, getState } from '../../modules/conversation/state.js';
import { getCustomer, searchCustomers } from '../../modules/customers/index.js';
import { getBusinessSummary } from '../../modules/ledger/index.js';
import {
  getBusinessSettings,
  listMemberships,
  resolveBusinessAccess,
  type BusinessAccess,
} from '../../modules/tenancy/index.js';
import type { BotContext } from '../bot.js';
import { matchMainKey, toKeyboard } from '../ui/keyboards.js';
import { customerMenuButtons } from '../ui/render.js';
import { STATE_AWAIT_LABEL } from './assistant.js';
import {
  describeStatus,
  langKeyboard,
  loadStatus,
  sendBusinessChooser,
  sendInvite,
  showHome,
  type HandlerDeps,
} from './onboarding.js';

/**
 * Pastki klaviatura, qo'llanma, obuna va mijoz tanlash: Mini App ochilmasa ham asosiy ishlar botda bajariladi.
 * Callback ma'lumotlari: v:<customer> (mijoz kartasi), nc (yangi mijoz), g:<mavzu> (qo'llanma), sub:inv|biz.
 */

const PICK_LIMIT = 8;
const DEBTORS_LIMIT = 10;

const GUIDE_TOPICS = ['debt', 'payment', 'view', 'delete', 'staff', 'subscription'] as const;
type GuideTopic = (typeof GUIDE_TOPICS)[number];

/** Tugmalarni ikkitadan qatorga joylaydi. */
function inPairs(kb: InlineKeyboard, items: readonly { text: string; data: string }[]): void {
  items.forEach((item, i) => {
    kb.text(item.text, item.data);
    if (i % 2 === 1) kb.row();
  });
  if (items.length % 2 === 1) kb.row();
}

export function registerMenu(bot: Bot<BotContext>, deps: HandlerDeps): void {
  const { pool } = deps;

  async function accessOrHome(ctx: BotContext): Promise<BusinessAccess | null> {
    try {
      return await resolveBusinessAccess(pool, ctx.user);
    } catch (error) {
      if (!(error instanceof BusinessRequiredError)) throw error;
      await showHome(ctx, deps);
      return null;
    }
  }

  // ───────── Qo'llanma ─────────

  function guideView(ctx: BotContext, topic: GuideTopic | 'home') {
    if (topic === 'home') {
      const kb = new InlineKeyboard();
      inPairs(
        kb,
        GUIDE_TOPICS.map((g) => ({ text: ctx.t(`guide.btn.${g}` as MessageKey), data: `g:${g}` })),
      );
      return { text: ctx.t('guide.home'), kb };
    }
    const text =
      topic === 'subscription'
        ? ctx.t('guide.subscription', {
            days: deps.config.billing.trialDays,
            price: formatUzs(deps.config.billing.priceUzs, ctx.user.locale),
          })
        : ctx.t(`guide.${topic}` as MessageKey);
    return { text, kb: new InlineKeyboard().text(ctx.t('guide.btn.back'), 'g:home') };
  }

  const sendGuide = (ctx: BotContext) => {
    const view = guideView(ctx, 'home');
    return ctx.reply(view.text, { reply_markup: view.kb });
  };

  // ───────── Mijoz tanlash (Nasiya / To'lov) ─────────

  async function pickCustomer(
    ctx: BotContext,
    access: BusinessAccess,
    kind: 'debt' | 'pay',
  ): Promise<void> {
    const locale = ctx.user.locale;
    // Oxirgi faol mijozlar birinchi: odatda shu odamlar bilan ishlanadi
    const page = await searchCustomers(pool, access, {
      sort: 'recent',
      limit: PICK_LIMIT,
      ...(kind === 'pay' ? { onlyDebtors: true } : {}),
    });
    if (page.items.length === 0) {
      await ctx.reply(ctx.t(kind === 'pay' ? 'pick.noDebtors' : 'pick.noCustomers'));
      return;
    }
    const kb = new InlineKeyboard();
    inPairs(
      kb,
      page.items.map((c) => ({
        text:
          kind === 'pay' ? `${displayName(c)} · ${formatUzs(c.balance, locale)}` : displayName(c),
        data: `m:${c.id}:${kind}`,
      })),
    );
    if (kind === 'debt') kb.text(ctx.t('button.newCustomer'), 'nc');
    await ctx.reply(ctx.t(kind === 'pay' ? 'pick.payment' : 'pick.debt'), { reply_markup: kb });
  }

  // ───────── Qarzdorlar ─────────

  async function sendDebtors(ctx: BotContext, access: BusinessAccess): Promise<void> {
    const locale = ctx.user.locale;
    const [page, summary] = await Promise.all([
      searchCustomers(pool, access, { onlyDebtors: true, sort: 'debt', limit: DEBTORS_LIMIT }),
      getBusinessSummary(pool, access),
    ]);
    if (page.items.length === 0) {
      await ctx.reply(ctx.t('debtors.empty'));
      return;
    }
    const lines = [
      ctx.t('debtors.title', {
        count: summary.debtorsCount,
        total: formatUzs(summary.totalDebt, locale),
      }),
      '',
    ];
    page.items.forEach((c, i) =>
      lines.push(
        ctx.t('debtors.line', {
          n: i + 1,
          name: displayName(c),
          balance: formatUzs(c.balance, locale),
        }),
      ),
    );
    const rest = summary.debtorsCount - page.items.length;
    if (rest > 0) lines.push(ctx.t('debtors.more', { count: rest }));
    lines.push('', ctx.t('debtors.pick'));

    const kb = new InlineKeyboard();
    inPairs(
      kb,
      page.items.map((c, i) => ({ text: `${i + 1}. ${displayName(c)}`, data: `v:${c.id}` })),
    );
    const appUrl = deps.config.telegram.miniAppUrl;
    if (appUrl) kb.webApp(ctx.t('menu.openApp'), appUrl);
    await ctx.reply(lines.join('\n'), { reply_markup: kb });
  }

  // ───────── Obuna (biznes kartasi) ─────────

  async function sendSubscription(ctx: BotContext, access: BusinessAccess): Promise<void> {
    const [settings, status, memberships] = await Promise.all([
      getBusinessSettings(pool, access),
      loadStatus(deps, access),
      listMemberships(pool, access.userId),
    ]);
    const phone = deps.config.billing.supportPhone;
    const lines = [
      ctx.t('sub.card', {
        name: settings.name,
        code: settings.shortCode,
        status: describeStatus(ctx, status),
        price: formatUzs(deps.config.billing.priceUzs, ctx.user.locale),
      }),
    ];
    if (status.state === 'EXPIRED') lines.push('', ctx.t('sub.readOnly'));
    if (phone) lines.push('', ctx.t('sub.howToPay', { phone }));

    const kb = new InlineKeyboard();
    // Admin chati telefon raqami bo'yicha ochiladi, xabar biznes kodi bilan tayyor turadi
    if (phone)
      kb.url(
        ctx.t('button.contactAdmin'),
        subscriptionRequestUrl(phone, ctx.user.locale, settings.shortCode),
      ).row();
    if (access.role === 'OWNER') kb.text(ctx.t('button.invite'), 'sub:inv').row();
    if (memberships.length > 1) kb.text(ctx.t('button.switchBusiness'), 'sub:biz').row();
    const appUrl = deps.config.telegram.miniAppUrl;
    if (appUrl) kb.webApp(ctx.t('menu.openApp'), appUrl);
    await ctx.reply(lines.join('\n'), { reply_markup: kb });
  }

  // ───────── Buyruqlar ─────────

  const sendLangPicker = (ctx: BotContext) =>
    ctx.reply(ctx.t('lang.pick'), { reply_markup: langKeyboard(ctx) });

  bot.command('help', sendGuide);
  bot.command(['lang', 'til'], sendLangPicker);
  bot.command('qarzdorlar', async (ctx) => {
    const access = await accessOrHome(ctx);
    if (access) await sendDebtors(ctx, access);
  });
  bot.command('obuna', async (ctx) => {
    const access = await accessOrHome(ctx);
    if (access) await sendSubscription(ctx, access);
  });

  // ───────── Pastki klaviatura ─────────

  bot.on('message:text', async (ctx, next) => {
    const key = matchMainKey(ctx.message.text);
    if (!key) return next();

    // Yorliq kutilayotgan bo'lsa bekor: keyingi matn yorliq deb olinmasin
    const state = await getState(pool, ctx.user.id);
    if (state?.state === STATE_AWAIT_LABEL) await clearState(pool, ctx.user.id);

    if (key === 'kb.lang') return sendLangPicker(ctx);
    if (key === 'kb.guide') return sendGuide(ctx);

    const access = await accessOrHome(ctx);
    if (!access) return;
    switch (key) {
      case 'kb.debt':
        return pickCustomer(ctx, access, 'debt');
      case 'kb.payment':
        return pickCustomer(ctx, access, 'pay');
      case 'kb.debtors':
        return sendDebtors(ctx, access);
      case 'kb.subscription':
        return sendSubscription(ctx, access);
    }
  });

  // ───────── Tugmalar ─────────

  bot.callbackQuery(/^g:(home|debt|payment|view|delete|staff|subscription)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const view = guideView(ctx, ctx.match[1] as GuideTopic | 'home');
    // Qo'llanma bitta xabar ichida varaqlanadi; tahrirlab bo'lmasa (eski xabar) yangisi yuboriladi
    await ctx
      .editMessageText(view.text, { reply_markup: view.kb })
      .catch(() => ctx.reply(view.text, { reply_markup: view.kb }));
  });

  bot.callbackQuery('nc', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(ctx.t('pick.newCustomer'));
  });

  bot.callbackQuery(/^v:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const access = await accessOrHome(ctx);
    if (!access) return;
    const customer = await getCustomer(pool, access, ctx.match[1]!).catch(() => null);
    if (!customer) return ctx.reply(ctx.t('view.customerNotFound'));
    const name = displayName(customer);
    const text =
      customer.balance > 0
        ? ctx.t('view.balance', { name, balance: formatUzs(customer.balance, ctx.user.locale) })
        : ctx.t('view.balanceZero', { name });
    const buttons = customerMenuButtons(customer.id, {
      locale: ctx.user.locale,
      t: ctx.t,
      draftId: null,
      supportLine: '',
      miniAppUrl: deps.config.telegram.miniAppUrl,
    });
    await ctx.reply(text, { reply_markup: toKeyboard(buttons) });
  });

  bot.callbackQuery(/^sub:(inv|biz)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (ctx.match[1] === 'biz') return sendBusinessChooser(ctx, deps);
    const access = await accessOrHome(ctx);
    if (access) await sendInvite(ctx, deps, access);
  });
}

/** BotFather'dagi "/" menyusi (setMyCommands). */
export const BOT_COMMANDS = [
  { command: 'menu', description: 'Asosiy menyu' },
  { command: 'qarzdorlar', description: 'Qarzdorlar ro‘yxati' },
  { command: 'obuna', description: 'Obuna holati va to‘lov' },
  { command: 'til', description: 'Tilni almashtirish / Тилни алмаштириш' },
  { command: 'help', description: 'Bot qanday ishlaydi' },
  { command: 'app', description: 'Ilovani ochish' },
  { command: 'invite', description: 'Xodim taklif qilish (egasi)' },
] as const;
