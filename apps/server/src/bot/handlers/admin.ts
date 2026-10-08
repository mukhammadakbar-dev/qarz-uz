import { randomBytes } from 'node:crypto';
import { formatUzs } from '@nasiya/shared';
import { InlineKeyboard, type Bot } from 'grammy';
import type { Pool } from 'pg';
import type { Config } from '../../config/index.js';
import { ConflictError, NotFoundError } from '../../errors/index.js';
import { t } from '../../i18n/index.js';
import {
  adminAudit,
  extendSubscription,
  findBusinessIdByCode,
  getAdminBusiness,
  listExpiring,
  subscriptionEndsAt,
} from '../../modules/admin/service.js';
import { clearState, getState, setState } from '../../modules/conversation/state.js';
import type { Logger } from '../../observability/logger.js';
import type { BotContext } from '../bot.js';
import { describeStatus, formatDate } from './onboarding.js';

/**
 * Superadmin bot buyruqlari (T5.1, ADR-0005/0008): /sub <kod>, /extend <kod> <oy> [izoh], /expiring [kun].
 * Superadmin bo'lmaganlar uchun buyruqlar mavjud emasdek: keyingi handlerga o'tadi ("Tushunmadim").
 * Uzaytirish idempotent emas, shuning uchun har doim tasdiq so'raladi; tasdiq tugmasi bir martalik nonce va
 * so'ralgan paytdagi tugash vaqtiga bog'langan — ikkinchi bosish yoki oraliqda o'zgargan obuna rad etiladi.
 */

export interface AdminBotDeps {
  readonly config: Pick<Config, 'billing'>;
  readonly pool: Pool;
  readonly sys: Pool | undefined;
  readonly logger: Logger;
}

const STATE_ADMIN_EXTEND = 'ADMIN_EXTEND';
const EXTEND_OPTIONS = [1, 3, 6, 12] as const;

interface PendingExtend {
  nonce: string;
  businessId: string;
  months: number;
  note: string | null;
  expectedEndsAt: string;
}

const addMonths = (d: Date, months: number): Date => {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + months);
  return r;
};

export function registerAdmin(bot: Bot<BotContext>, deps: AdminBotDeps): void {
  const { pool, logger } = deps;
  const isAdmin = (ctx: BotContext) =>
    deps.config.billing.superadminTelegramIds.includes(ctx.user.telegramUserId);

  /** Superadmin bo'lmasa (yoki tizim pool'i yo'q bo'lsa) — keyingi handlerga. */
  const adminOnly =
    (handler: (ctx: BotContext, sys: Pool) => Promise<unknown>) =>
    async (ctx: BotContext, next: () => Promise<void>) => {
      if (!isAdmin(ctx)) return next();
      if (!deps.sys) return ctx.reply(ctx.t('adm.unavailable'));
      return handler(ctx, deps.sys);
    };

  const args = (ctx: BotContext): string[] =>
    (typeof ctx.match === 'string' ? ctx.match : '').trim().split(/\s+/).filter(Boolean);

  async function sendCard(ctx: BotContext, sys: Pool, businessId: string): Promise<void> {
    const b = await getAdminBusiness(sys, businessId);
    await adminAudit(sys, {
      actorUserId: ctx.user.id,
      businessId,
      action: 'admin.business.view',
      entity: 'business',
      entityId: businessId,
    });
    const locale = ctx.user.locale;
    const text = ctx.t('adm.card', {
      name: b.name,
      code: b.shortCode,
      owner: `${b.owner.name}${b.owner.username ? ` (@${b.owner.username})` : ''} · ID ${b.owner.telegramUserId}`,
      status: describeStatus(ctx, b.subscription),
      customers: b.customers,
      debt: formatUzs(b.totalDebt, locale),
      last: b.lastEntryAt ? formatDate(b.lastEntryAt) : ctx.t('adm.never'),
      suspended: b.suspendedAt
        ? ctx.t('adm.suspendedLine', { date: formatDate(b.suspendedAt) })
        : '',
    });
    const kb = new InlineKeyboard();
    EXTEND_OPTIONS.forEach((m, i) => {
      kb.text(ctx.t('adm.extendButton', { months: m }), `as:${businessId}:${m}`);
      if (i % 2 === 1) kb.row();
    });
    await ctx.reply(text, { reply_markup: kb });
  }

  /** Tasdiq so'rovi: holat saqlanadi, tugma faqat nonce'ni olib yuradi (64 bayt chegarasi). */
  async function askExtend(
    ctx: BotContext,
    sys: Pool,
    businessId: string,
    months: number,
    note: string | null,
  ): Promise<void> {
    const b = await getAdminBusiness(sys, businessId);
    const endsAt = await subscriptionEndsAt(sys, businessId);
    const pending: PendingExtend = {
      nonce: randomBytes(6).toString('base64url'),
      businessId,
      months,
      note,
      expectedEndsAt: endsAt.toISOString(),
    };
    await setState(pool, ctx.user.id, STATE_ADMIN_EXTEND, { ...pending });
    const base = new Date(Math.max(Date.now(), endsAt.getTime()));
    await ctx.reply(
      ctx.t('adm.extendConfirm', {
        name: b.name,
        code: b.shortCode,
        months,
        amount: formatUzs(deps.config.billing.priceUzs * months, ctx.user.locale),
        until: formatDate(addMonths(base, months)),
        note: note ? ctx.t('adm.noteLine', { note }) : '',
      }),
      {
        reply_markup: new InlineKeyboard()
          .text(ctx.t('adm.confirmYes'), `ae:${pending.nonce}`)
          .text(ctx.t('button.cancel'), 'ax'),
      },
    );
  }

  bot.command(
    'sub',
    adminOnly(async (ctx, sys) => {
      const [code] = args(ctx);
      if (!code) return ctx.reply(ctx.t('adm.usageSub'));
      const id = await findBusinessIdByCode(sys, code);
      if (!id) return ctx.reply(ctx.t('adm.notFound', { code }));
      await sendCard(ctx, sys, id);
    }),
  );

  bot.command(
    'extend',
    adminOnly(async (ctx, sys) => {
      const [code, monthsRaw, ...rest] = args(ctx);
      const months = Number(monthsRaw);
      if (!code || !Number.isInteger(months) || months < 1 || months > 36)
        return ctx.reply(ctx.t('adm.usageExtend'));
      const id = await findBusinessIdByCode(sys, code);
      if (!id) return ctx.reply(ctx.t('adm.notFound', { code }));
      const note = rest.join(' ').slice(0, 300) || null;
      await askExtend(ctx, sys, id, months, note);
    }),
  );

  bot.command(
    'expiring',
    adminOnly(async (ctx, sys) => {
      const [daysRaw] = args(ctx);
      const days = Math.min(Math.max(Number(daysRaw) || 7, 1), 60);
      const list = await listExpiring(sys, days);
      if (list.length === 0) return ctx.reply(ctx.t('adm.expiringNone', { days }));
      const now = Date.now();
      const lines = [ctx.t('adm.expiringTitle', { days, count: list.length }), ''];
      list.forEach((b, i) =>
        lines.push(
          ctx.t('adm.expiringLine', {
            n: i + 1,
            code: b.shortCode,
            name: b.name,
            left: ctx.t('adm.leftDays', {
              days: Math.ceil((b.endsAt.getTime() - now) / 86_400_000),
            }),
            date: formatDate(b.endsAt),
            owner: b.owner,
            trial: b.isTrial ? ctx.t('adm.trialTag') : '',
          }),
        ),
      );
      lines.push('', ctx.t('adm.expiringHint'));
      await ctx.reply(lines.join('\n'));
    }),
  );

  // /sub kartasidagi "+N oy" → tasdiq so'rovi
  bot.callbackQuery(
    /^as:([0-9a-f-]{36}):(\d{1,2})$/,
    adminOnly(async (ctx, sys) => {
      await ctx.answerCallbackQuery();
      const [, businessId, months] = ctx.match as unknown as [string, string, string];
      const m = Number(months);
      if (!EXTEND_OPTIONS.includes(m as (typeof EXTEND_OPTIONS)[number])) return;
      await askExtend(ctx, sys, businessId, m, null);
    }),
  );

  bot.callbackQuery(
    'ax',
    adminOnly(async (ctx) => {
      await ctx.answerCallbackQuery();
      await clearState(pool, ctx.user.id);
      await ctx
        .editMessageReplyMarkup({ reply_markup: new InlineKeyboard() })
        .catch(() => undefined);
      await ctx.reply(ctx.t('cancelled'));
    }),
  );

  bot.callbackQuery(
    /^ae:([A-Za-z0-9_-]{8})$/,
    adminOnly(async (ctx, sys) => {
      await ctx.answerCallbackQuery();
      await ctx
        .editMessageReplyMarkup({ reply_markup: new InlineKeyboard() })
        .catch(() => undefined);
      const state = await getState(pool, ctx.user.id);
      const pending =
        state?.state === STATE_ADMIN_EXTEND ? (state.data as unknown as PendingExtend) : null;
      const nonce = (ctx.match as RegExpMatchArray)[1];
      if (!pending || pending.nonce !== nonce) return ctx.reply(ctx.t('adm.stale'));
      // Bir martalik: ikkinchi bosish (yoki boshqa tasdiq) endi holatni topmaydi
      await clearState(pool, ctx.user.id);
      try {
        const amount = deps.config.billing.priceUzs * pending.months;
        const result = await extendSubscription(sys, {
          businessId: pending.businessId,
          months: pending.months,
          amount,
          note: pending.note,
          actorUserId: ctx.user.id,
          expectedEndsAt: new Date(pending.expectedEndsAt),
        });
        await ctx.reply(
          ctx.t('adm.extended', {
            name: result.name,
            date: formatDate(result.paidUntil),
            amount: formatUzs(amount, ctx.user.locale),
          }),
        );
        await ctx.api
          .sendMessage(
            result.ownerTelegramId,
            t(result.ownerLocale, 'admin.extended', {
              name: result.name,
              date: formatDate(result.paidUntil),
            }),
          )
          .catch((error: unknown) =>
            logger.warn({ err: error }, 'egasiga uzaytirish xabari yuborilmadi'),
          );
      } catch (error) {
        if (error instanceof ConflictError || error instanceof NotFoundError)
          return ctx.reply(ctx.t('adm.stale'));
        throw error;
      }
    }),
  );
}

/** "/" menyusi: superadminlar uchun qo'shimcha buyruqlar (chat bo'yicha). */
export const ADMIN_COMMANDS = [
  { command: 'sub', description: 'Do‘kon holati: /sub <kod>' },
  { command: 'extend', description: 'Obunani uzaytirish: /extend <kod> <oy>' },
  { command: 'expiring', description: 'Yaqinda tugaydigan obunalar' },
] as const;
