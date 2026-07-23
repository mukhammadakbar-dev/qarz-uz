import { t, money } from '../lib/i18n.js';
import { api } from '../lib/api.js';
import { sessions } from '../lib/sessions.js';
import { mainMenu, langKeyboard, debtorActions } from '../keyboards/index.js';

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
    // send each debtor as its own message so inline actions attach per debtor
    for (let i = 0; i < debtors.length && i < 20; i++) {
      const d = debtors[i];
      const line = t('debtor_line', lang, {
        i: i + 1,
        name: d.full_name,
        outstanding: money(d.outstanding),
        count: d.debt_count,
      });
      await ctx.reply(line, {
        parse_mode: 'HTML',
        reply_markup: debtorActions(lang, d.id),
      });
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
