import { formatSigned, formatUzs } from '@nasiya/shared';
import {
  displayName,
  redecide,
  step,
  type Decision,
  type DialogEvent,
  type StepResult,
} from '@nasiya/nlp';
import { InlineKeyboard, type Bot } from 'grammy';
import type { Pool } from 'pg';
import type { Config } from '../../config/index.js';
import {
  BusinessRequiredError,
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  OverpaymentError,
  SubscriptionExpiredError,
  ValidationError,
} from '../../errors/index.js';
import type { MessageKey } from '../../i18n/index.js';
import { createAssistantEnv, type AssistantEnv } from '../../modules/assistant/env.js';
import { notifyOwnerOfDeletion } from '../../modules/assistant/notify.js';
import { isBusinessSuspended } from '../../modules/billing/guard.js';
import { commitDraft } from '../../modules/assistant/commit.js';
import { createDraft, loadDraft, transitionDraft } from '../../modules/conversation/drafts.js';
import {
  EMPTY_DIALOG,
  loadDialog,
  saveDialog,
  type StoredDialog,
} from '../../modules/conversation/dialog-store.js';
import { clearState, getState, setState } from '../../modules/conversation/state.js';
import { createCustomer, getCustomer } from '../../modules/customers/index.js';
import {
  interpret,
  setOutcome,
  type AiDeps,
  type InterpretationOutcome,
} from '../../modules/interpretation/service.js';
import { deleteEntry, getEntry, getHistory } from '../../modules/ledger/index.js';
import { resolveBusinessAccess, type BusinessAccess } from '../../modules/tenancy/index.js';
import type { Logger } from '../../observability/logger.js';
import type { BotContext } from '../bot.js';
import { toKeyboard } from '../ui/keyboards.js';
import { renderDecision, type Rendered, type RenderContext } from '../ui/render.js';
import { renewKeyboard, showHome } from './onboarding.js';

export const STATE_AWAIT_LABEL = 'AWAIT_LABEL';
const TIMEZONE = 'Asia/Tashkent';
const HISTORY_PAGE = 8;

export interface AssistantDeps {
  readonly config: Pick<Config, 'telegram' | 'billing'>;
  readonly pool: Pool;
  readonly logger: Logger;
  readonly ai?: AiDeps | undefined;
}

const shortDate = (d: Date): string =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, day: '2-digit', month: '2-digit' })
    .format(d)
    .replace('/', '.');

export function registerAssistant(bot: Bot<BotContext>, deps: AssistantDeps): void {
  const { pool, logger } = deps;

  // ───────── Yordamchilar ─────────

  const supportLine = (ctx: BotContext): string =>
    deps.config.billing.supportPhone
      ? ctx.t('status.pay', { phone: deps.config.billing.supportPhone })
      : '';

  const renderCtx = (ctx: BotContext, draftId: string | null): RenderContext => ({
    locale: ctx.user.locale,
    t: ctx.t,
    draftId,
    supportLine: supportLine(ctx),
    miniAppUrl: deps.config.telegram.miniAppUrl,
  });

  async function accessOf(ctx: BotContext): Promise<BusinessAccess | null> {
    try {
      return await resolveBusinessAccess(pool, ctx.user);
    } catch (error) {
      if (error instanceof BusinessRequiredError) {
        if (error.details['reason'] === 'NO_MEMBERSHIP') await ctx.reply(ctx.t('error.noBusiness'));
        else await showHome(ctx, { ...deps, botUsername: () => bot.botInfo.username });
        return null;
      }
      throw error;
    }
  }

  async function makeEnv(ctx: BotContext, access: BusinessAccess): Promise<AssistantEnv> {
    return createAssistantEnv(pool, access, (text) =>
      interpret({ pool, logger, ai: deps.ai }, access, text),
    );
  }

  const reply = async (ctx: BotContext, rendered: Rendered): Promise<void> => {
    await ctx.reply(
      rendered.text,
      rendered.buttons.length ? { reply_markup: toKeyboard(rendered.buttons) } : {},
    );
  };

  /** Eski qoralamani (bor bo'lsa) yopadi: bekor qilingan yoki yangisi bilan almashtirilgan. */
  async function retireDraft(
    access: BusinessAccess,
    stored: StoredDialog,
    to: 'CANCELLED' | 'SUPERSEDED',
  ): Promise<void> {
    if (stored.draftId) await transitionDraft(pool, access, stored.draftId, to);
  }

  const outcomeOf = (action: Decision['action']): InterpretationOutcome | null =>
    action === 'CANCELLED'
      ? 'CANCELLED'
      : action === 'UNKNOWN'
        ? 'UNKNOWN'
        : action.startsWith('REJECT')
          ? 'REJECTED'
          : action === 'ASK_AMOUNT' || action === 'ASK_CUSTOMER'
            ? 'CLARIFIED'
            : null;

  /**
   * Bitta reducer qadamini bajaradi: holatni yuklaydi, qaror chiqaradi, qoralamani yaratadi/yopadi, holatni saqlaydi,
   * natijani foydalanuvchiga yuboradi.
   */
  async function runStep(
    ctx: BotContext,
    access: BusinessAccess,
    event: DialogEvent,
  ): Promise<void> {
    const stored = await loadDialog(pool, ctx.user.id);
    const env = await makeEnv(ctx, access);
    const result = await step(stored.dialog, event, env);
    await present(ctx, access, stored, result, env);
  }

  async function present(
    ctx: BotContext,
    access: BusinessAccess,
    stored: StoredDialog,
    result: StepResult,
    env: AssistantEnv | null,
  ): Promise<void> {
    const { decision } = result;
    const hadDraft = stored.draftId !== null;

    // Oldingi qoralama: bekor qilingan yoki almashtirilgan
    if (hadDraft) {
      await retireDraft(
        access,
        stored,
        decision.action === 'CANCELLED' ? 'CANCELLED' : 'SUPERSEDED',
      );
      if (result.supersededPrevious) await ctx.reply(ctx.t('draft.superseded'));
    }

    let draftId: string | null = null;
    const interpretationId = env?.lastInterpretationId() ?? stored.interpretationId;
    if (decision.draft) {
      draftId = (await createDraft(pool, access, decision.draft, interpretationId)).id;
    }
    await saveDialog(pool, ctx.user.id, { dialog: result.state, draftId, interpretationId });

    const outcome = outcomeOf(decision.action);
    if (outcome && stored.dialog.kind === 'IDLE')
      await setOutcome({ pool, logger }, access, interpretationId, outcome);

    switch (decision.action) {
      case 'SHOW_HISTORY':
        if (decision.customer) await sendHistory(ctx, access, decision.customer.id);
        return;
      case 'CREATE_CUSTOMER_FLOW':
        await createCustomerFlow(ctx, access, decision, env?.lastParsedPhone());
        return;
      default: {
        const rendered = renderDecision(decision, renderCtx(ctx, draftId), {
          reason: env?.lastParsedReason(),
        });
        if (!rendered) return;
        if (decision.action === 'BLOCKED_SUBSCRIPTION') {
          if (await isBusinessSuspended(pool, access)) {
            await ctx.reply(ctx.t('blocked.suspended'));
            return;
          }
          // Obuna tugagan: uzaytirish so'rovi bir bosishda (admin chatida xabar tayyor)
          const kb = await renewKeyboard(ctx, deps, access);
          await ctx.reply(rendered.text, kb ? { reply_markup: kb } : {});
          return;
        }
        await reply(ctx, rendered);
      }
    }
  }

  // ───────── Mijoz yaratish ─────────

  async function createCustomerFlow(
    ctx: BotContext,
    access: BusinessAccess,
    decision: Decision,
    phone: string | undefined,
  ): Promise<void> {
    const name = decision.newCustomerName ?? '';
    if (decision.askLabel) {
      await setState(pool, ctx.user.id, STATE_AWAIT_LABEL, { name, phone: phone ?? null });
      await ctx.reply(ctx.t('customer.askLabel', { name }));
      return;
    }
    await finishCreateCustomer(ctx, access, { name, phone: phone ?? null, label: null });
  }

  async function finishCreateCustomer(
    ctx: BotContext,
    access: BusinessAccess,
    input: { name: string; phone: string | null; label: string | null },
  ): Promise<void> {
    try {
      const created = await createCustomer(pool, access, input);
      await ctx.reply(ctx.t('customer.created', { name: displayName(created) }));
    } catch (error) {
      await replyDomainError(ctx, error);
    }
  }

  // ───────── Xatolarni foydalanuvchi tiliga o'girish ─────────

  async function replyDomainError(ctx: BotContext, error: unknown): Promise<void> {
    if (error instanceof OverpaymentError) {
      await ctx.reply(
        error.maxPayable === 0
          ? ctx.t('reject.noDebt', { name: '', balance: formatUzs(0, ctx.user.locale) }).trim()
          : ctx
              .t('reject.overpay', {
                name: '',
                balance: formatUzs(error.maxPayable, ctx.user.locale),
                amount: '',
              })
              .trim(),
      );
    } else if (
      error instanceof SubscriptionExpiredError &&
      error.details['reason'] === 'SUSPENDED'
    ) {
      await ctx.reply(ctx.t('blocked.suspended'));
    } else if (error instanceof SubscriptionExpiredError) {
      const access = await resolveBusinessAccess(pool, ctx.user).catch(() => null);
      const kb = access ? await renewKeyboard(ctx, deps, access) : undefined;
      await ctx.reply(
        [ctx.t('blocked.subscription'), supportLine(ctx)].filter(Boolean).join('\n'),
        kb ? { reply_markup: kb } : {},
      );
    } else if (error instanceof ForbiddenError) {
      await ctx.reply(ctx.t('error.forbidden'));
    } else if (error instanceof NotFoundError) {
      await ctx.reply(ctx.t('view.customerNotFound'));
    } else if (error instanceof ConflictError) {
      const reason = error.details['reason'];
      if (reason === 'REVERSAL_WOULD_OVERDRAW') await ctx.reply(ctx.t('delete.wouldOverdraw'));
      else if (reason === 'ALREADY_REVERSED') await ctx.reply(ctx.t('delete.alreadyReversed'));
      else if (reason === 'CANNOT_REVERSE_REVERSAL') await ctx.reply(ctx.t('delete.cannotReverse'));
      else if (reason === 'LABEL_REQUIRED' || reason === 'DUPLICATE_IDENTITY')
        await ctx.reply(ctx.t('customer.exists'));
      else await ctx.reply(ctx.t('error.generic'));
    } else if (error instanceof ValidationError) {
      await ctx.reply(ctx.t('customer.labelInvalid'));
    } else if (error instanceof DomainError) {
      await ctx.reply(ctx.t('error.generic'));
    } else {
      throw error;
    }
  }

  // ───────── Tarix va o'chirish ─────────

  async function sendHistory(
    ctx: BotContext,
    access: BusinessAccess,
    customerId: string,
    beforeSeq?: number,
  ): Promise<void> {
    const locale = ctx.user.locale;
    const customer = await getCustomer(pool, access, customerId).catch(() => null);
    if (!customer) {
      await ctx.reply(ctx.t('view.customerNotFound'));
      return;
    }
    const page = await getHistory(pool, access, customerId, {
      limit: HISTORY_PAGE,
      ...(beforeSeq ? { beforeSeq } : {}),
    });
    if (page.items.length === 0) {
      await ctx.reply(ctx.t('history.empty', { name: displayName(customer) }));
      return;
    }
    const lines = [
      ctx.t('history.title', {
        name: displayName(customer),
        balance: formatUzs(customer.balance, locale),
      }),
    ];
    const kb = new InlineKeyboard();
    let n = 0;
    for (const item of page.items) {
      n++;
      const type = item.isReversal
        ? ctx.t('type.REVERSAL')
        : ctx.t(`type.${item.type}` as MessageKey);
      lines.push(
        ctx.t('history.line', {
          n,
          date: shortDate(item.occurredAt),
          delta: formatSigned(item.delta),
          type,
          deleted: item.reversedBy ? ctx.t('history.deleted') : '',
        }),
      );
      if (!item.isReversal && !item.reversedBy) kb.text(`🗑 ${n}`, `del:${item.id}`);
    }
    kb.row();
    const last = page.items.at(-1)!;
    if (page.nextCursor) kb.text(ctx.t('button.olderEntries'), `h:${customerId}:${last.seq}`);
    await ctx.reply(lines.join('\n'), { reply_markup: kb });
  }

  // ───────── Qoralamani tasdiqlash ─────────

  async function handleCommit(ctx: BotContext, draftId: string): Promise<void> {
    const access = await accessOf(ctx);
    if (!access) return;
    const stored = await loadDialog(pool, ctx.user.id);
    const locale = ctx.user.locale;
    const removeKeyboard = () =>
      ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() }).catch(() => undefined);

    const outcome = await commitDraft(pool, access, draftId);
    switch (outcome.kind) {
      case 'saved': {
        await removeKeyboard();
        const name = displayName(outcome.customer);
        const spec = outcome.draft.spec;
        if (!outcome.fresh) {
          await ctx.reply(ctx.t('saved.already'));
        } else {
          await ctx.reply(
            ctx.t(spec.type === 'DEBT' ? 'saved.debt' : 'saved.payment', {
              name,
              amount: formatUzs(spec.amount, locale),
              balance: formatUzs(outcome.result.balance, locale),
            }),
          );
          await setOutcome({ pool, logger }, access, outcome.draft.interpretationId, 'CONFIRMED');
        }
        if (stored.draftId === draftId) await clearState(pool, ctx.user.id);
        return;
      }
      case 'stale': {
        // Qoldiq o'zgargan: eski qoralama yopiladi, yangi qoldiq bilan qayta tasdiq so'raladi
        await removeKeyboard();
        await transitionDraft(pool, access, draftId, 'SUPERSEDED');
        await ctx.reply(
          ctx.t('saved.stale', { balance: formatUzs(outcome.currentBalance, locale) }),
        );
        const env = await makeEnv(ctx, access);
        const redone = await redecide(outcome.draft.spec, env);
        await present(ctx, access, { ...EMPTY_DIALOG }, redone, env);
        return;
      }
      case 'expired':
        await removeKeyboard();
        await ctx.reply(ctx.t('draft.expired'));
        return;
      case 'cancelled':
        await removeKeyboard();
        await ctx.reply(ctx.t('draft.cancelled'));
        return;
      case 'not_found':
        await removeKeyboard();
        await ctx.reply(ctx.t('draft.expired'));
        return;
      case 'not_owner':
        await ctx.reply(ctx.t('draft.notOwner'));
        return;
      case 'rejected':
        await removeKeyboard();
        await replyDomainError(ctx, outcome.error);
        return;
    }
  }

  // ───────── Matnli xabarlar ─────────

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    // Noma'lum buyruqlar tahlilga yuborilmaydi
    if (text.startsWith('/')) return ctx.reply(ctx.t('fallback.unknown'));

    const access = await accessOf(ctx);
    if (!access) return;

    // Yorliq kutilmoqda (mijoz yaratish)
    const row = await getState(pool, ctx.user.id);
    if (row?.state === STATE_AWAIT_LABEL) {
      await clearState(pool, ctx.user.id);
      const data = row.data as { name: string; phone: string | null };
      return finishCreateCustomer(ctx, access, { name: data.name, phone: data.phone, label: text });
    }

    await runStep(ctx, access, { type: 'text', text });
  });

  // Tahrirlangan xabar hisobga olinmaydi (moliyaviy noaniqlik)
  bot.on('edited_message', (ctx) => ctx.reply(ctx.t('unknown.edited')));

  // ───────── Tugmalar ─────────

  bot.callbackQuery(/^d:([0-9a-f-]{36}):(ok|edit|no)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const [, draftId, action] = ctx.match as unknown as [string, string, string];
    if (action === 'ok') return handleCommit(ctx, draftId);

    const access = await accessOf(ctx);
    if (!access) return;
    const stored = await loadDialog(pool, ctx.user.id);
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() }).catch(() => undefined);

    if (stored.draftId !== draftId) {
      // Boshqa so'rov davom etmoqda yoki holat eskirgan
      const draft = await loadDraft(pool, access, draftId);
      if (draft?.userId === access.userId && draft.status === 'PENDING')
        await transitionDraft(pool, access, draftId, 'CANCELLED');
      return ctx.reply(ctx.t('draft.expired'));
    }
    if (action === 'edit') {
      await setOutcome({ pool, logger }, access, stored.interpretationId, 'EDITED');
      return runStep(ctx, access, { type: 'button', id: 'other_amount' });
    }
    return runStep(ctx, access, { type: 'button', id: 'cancel' });
  });

  bot.callbackQuery(/^c:(\d|new)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const access = await accessOf(ctx);
    if (!access) return;
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() }).catch(() => undefined);
    const which = ctx.match[1]!;
    await runStep(
      ctx,
      access,
      which === 'new'
        ? { type: 'button', id: 'new_customer' }
        : { type: 'pick', index: Number(which) },
    );
  });

  bot.callbackQuery(/^(x:cancel|o:max|o:other)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const access = await accessOf(ctx);
    if (!access) return;
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() }).catch(() => undefined);
    const id = ctx.match[1]!;
    await runStep(ctx, access, {
      type: 'button',
      id: id === 'o:max' ? 'pay_max' : id === 'o:other' ? 'other_amount' : 'cancel',
    });
  });

  // Mijoz menyusi: nasiya / to'lov / tarix
  bot.callbackQuery(/^m:([0-9a-f-]{36}):(debt|pay|hist)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const access = await accessOf(ctx);
    if (!access) return;
    const [, customerId, what] = ctx.match as unknown as [string, string, 'debt' | 'pay' | 'hist'];
    if (what === 'hist') return sendHistory(ctx, access, customerId);

    const customer = await getCustomer(pool, access, customerId).catch(() => null);
    if (!customer) return ctx.reply(ctx.t('view.customerNotFound'));
    const stored = await loadDialog(pool, ctx.user.id);
    await retireDraft(access, stored, 'SUPERSEDED');
    await saveDialog(pool, ctx.user.id, {
      dialog: {
        kind: 'AWAIT_AMOUNT',
        intent: what === 'debt' ? 'CREATE_DEBT' : 'CREATE_PAYMENT',
        customerId,
        newCustomerName: null,
        dateOffsetDays: 0,
      },
      draftId: null,
      interpretationId: null,
    });
    await ctx.reply(
      ctx.t(what === 'debt' ? 'ask.amountDebt' : 'ask.amountPayment', {
        name: displayName(customer),
      }),
      {
        reply_markup: new InlineKeyboard().text(ctx.t('button.cancel'), 'x:cancel'),
      },
    );
  });

  bot.callbackQuery(/^h:([0-9a-f-]{36}):(\d{1,18})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const access = await accessOf(ctx);
    if (!access) return;
    await sendHistory(ctx, access, ctx.match[1]!, Number(ctx.match[2]));
  });

  // O'chirish (storno): tasdiqlash → bajarish
  bot.callbackQuery(/^del:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const access = await accessOf(ctx);
    if (!access) return;
    try {
      const entry = await getEntry(pool, access, ctx.match[1]!);
      if (entry.reversesEntryId || entry.reversedBy)
        return ctx.reply(ctx.t('delete.alreadyReversed'));
      const kb = new InlineKeyboard()
        .text(ctx.t('button.confirmDelete'), `delok:${entry.id}`)
        .text(ctx.t('button.no'), 'delno');
      await ctx.reply(
        ctx.t('delete.confirm', {
          name: displayName({ name: entry.customerName, label: entry.customerLabel }),
          date: shortDate(entry.occurredAt),
          delta: formatSigned(entry.delta),
          type: ctx.t(`type.${entry.type}` as MessageKey),
        }),
        { reply_markup: kb },
      );
    } catch (error) {
      await replyDomainError(ctx, error);
    }
  });

  bot.callbackQuery('delno', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() }).catch(() => undefined);
  });

  bot.callbackQuery(/^delok:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const access = await accessOf(ctx);
    if (!access) return;
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() }).catch(() => undefined);
    const entryId = ctx.match[1]!;
    try {
      const detail = await getEntry(pool, access, entryId);
      // Kalit yozuvga bog'langan: bir yozuv faqat bir marta o'chiriladi, takroriy bosish idempotent
      const result = await deleteEntry(pool, access, {
        entryId,
        idempotencyKey: `del:${entryId}`,
        source: 'BOT',
      });
      await ctx.reply(
        ctx.t('delete.done', { balance: formatUzs(result.balance, ctx.user.locale) }),
      );
      if (result.notifyOwner) {
        await notifyOwnerOfDeletion(
          { pool, logger, send: (chatId, text) => ctx.api.sendMessage(chatId, text) },
          access,
          {
            name: ctx.user.firstName ?? ctx.user.username ?? String(ctx.user.telegramUserId),
            telegramUserId: ctx.user.telegramUserId,
          },
          detail,
          result.balance,
        );
      }
    } catch (error) {
      await replyDomainError(ctx, error);
    }
  });

  // Matn bo'lmagan xabarlar (ovoz, rasm, stiker...)
  bot.on('message', (ctx) => ctx.reply(ctx.t('unknown.nonText')));
}
