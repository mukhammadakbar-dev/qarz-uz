import { t, money } from '../lib/i18n.js';
import { api } from '../lib/api.js';
import { sessions } from '../lib/sessions.js';
import { mainMenu, langKeyboard, debtorActions } from '../keyboards/index.js';

// Telegram allows ~1 message/second per chat before it starts returning 429.
const MAX_DEBTORS_LISTED = 20;
const SEND_SPACING_MS = 120;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Shared error reply: session loss gets its own message. */
const replyError = (ctx, lang, err) =>
  ctx.reply(
    err?.code === 'SESSION_EXPIRED'
      ? t('session_expired', lang)
      : t('error_generic', lang, { msg: err.message })
  );

/** Show debtors list with quick-action inline buttons. */
export const handleDebtors = async (ctx) => {
  const tgId = ctx.from.id;
  const sess = sessions.get(tgId);
  const lang = sess?.lang || 'uz';
  if (!sess?.accessToken) return ctx.reply(t('session_expired', lang));

  try {
    const debtors = await api.listDebtors(tgId, { filter: 'with_debt' });
    if (!debtors.length) return ctx.reply(t('debtors_empty', lang));

    await ctx.reply(t('debtors_header', lang), { parse_mode: 'HTML' });

    // Each debtor needs its own message so the inline actions attach to the
    // right row. Telegram throttles at roughly one message per second per chat,
    // and firing 20 back-to-back tripped 429s that aborted the whole listing
    // partway through. Pace the sends and never let one failure lose the rest.
    const shown = debtors.slice(0, MAX_DEBTORS_LISTED);
    for (const [i, d] of shown.entries()) {
      const line = t('debtor_line', lang, {
        i: i + 1,
        name: d.full_name,
        outstanding: money(d.outstanding),
        count: d.debt_count,
      });
      try {
        await ctx.reply(line, {
          parse_mode: 'HTML',
          reply_markup: debtorActions(lang, d.id),
        });
      } catch (err) {
        console.error('[bot] failed to send debtor row:', err.message);
      }
      if (i < shown.length - 1) await sleep(SEND_SPACING_MS);
    }

    if (debtors.length > shown.length) {
      await ctx.reply(
        t('debtors_truncated', lang, { shown: shown.length, total: debtors.length })
      );
    }
  } catch (err) {
    await replyError(ctx, lang, err);
  }
};

/** Dashboard summary. */
export const handleDashboard = async (ctx) => {
  const tgId = ctx.from.id;
  const sess = sessions.get(tgId);
  const lang = sess?.lang || 'uz';
  if (!sess?.accessToken) return ctx.reply(t('session_expired', lang));

  try {
    const d = await api.dashboard(tgId);
    const smsLeft = d.sms ? d.sms.remaining + (d.sms.extra_package || 0) : 0;
    await ctx.reply(
      t('dashboard', lang, {
        outstanding: money(d.totalOutstanding),
        overdueCount: d.overdueCount,
        overdueTotal: money(d.overdueTotal),
        turnover: money(d.monthlyTurnover),
        sms: smsLeft,
      }),
      { parse_mode: 'HTML', reply_markup: mainMenu(lang, sess.role) }
    );
  } catch (err) {
    await replyError(ctx, lang, err);
  }
};

/** Language menu + callback. */
export const handleLangMenu = async (ctx) => {
  const lang = sessions.get(ctx.from.id)?.lang || 'uz';
  await ctx.reply(t('lang_choose', lang), { reply_markup: langKeyboard() });
};

export const handleLangCallback = async (ctx) => {
  const chosen = ctx.callbackQuery.data.split(':')[1];
  const tgId = ctx.from.id;
  const sess = sessions.set(tgId, { lang: chosen });
  await ctx.answerCallbackQuery();
  await ctx.reply(t('lang_set', chosen), {
    reply_markup: mainMenu(chosen, sess.role),
  });
};

/** Debtor history inline callback. */
export const handleHistoryCallback = async (ctx) => {
  const debtorId = ctx.callbackQuery.data.split(':')[1];
  const tgId = ctx.from.id;
  const sess = sessions.get(tgId);
  const lang = sess?.lang || 'uz';
  await ctx.answerCallbackQuery();
  if (!sess?.accessToken) return ctx.reply(t('session_expired', lang));

  try {
    const debts = await api.debtorHistory(tgId, debtorId);
    if (!debts.length) return ctx.reply('—');
    const lines = debts.map((d) => {
      const left = Number(d.amount) - Number(d.paid_amount);
      const status = { open: '🟡', partial: '🟠', overdue: '🔴', paid: '🟢' }[d.status] || '';
      return `${status} ${money(d.amount)} (qoldiq: ${money(left)}) — ${d.due_date || '—'}`;
    });
    await ctx.reply(lines.join('\n'));
  } catch (err) {
    await replyError(ctx, lang, err);
  }
};

/** Payment link callback */
export const handlePayLinkCallback = async (ctx) => {
  const debtId = ctx.callbackQuery.data.split(':')[1];
  const tgId = ctx.from.id;
  const sess = sessions.get(tgId);
  const lang = sess?.lang || 'uz';
  await ctx.answerCallbackQuery();
  if (!sess?.accessToken) return ctx.reply(t('session_expired', lang));

  try {
    const link = await api.paymentLink(tgId, debtId);
    await ctx.reply(t('pay_link_msg', lang, { url: link.url }), { parse_mode: 'HTML' });
  } catch (err) {
    await replyError(ctx, lang, err);
  }
};

/**
 * Builds the customer-facing payment link so the shop owner can forward it.
 *
 * This used to report "kvitansiya mijozga yuborildi" (receipt sent to the
 * customer) while doing nothing of the sort — it only created a link and showed
 * it back to the owner. Owners had no way to tell the message was untrue, so
 * customers silently never got anything. The wording now matches the behaviour.
 */
export const handleReceiptSendCallback = async (ctx) => {
  const debtId = ctx.callbackQuery.data.split(':')[1];
  const tgId = ctx.from.id;
  const sess = sessions.get(tgId);
  const lang = sess?.lang || 'uz';
  await ctx.answerCallbackQuery();
  if (!sess?.accessToken) return ctx.reply(t('session_expired', lang));

  try {
    const link = await api.paymentLink(tgId, debtId);
    await ctx.reply(t('receipt_share_msg', lang, { url: link.url }), { parse_mode: 'HTML' });
  } catch (err) {
    await replyError(ctx, lang, err);
  }
};

