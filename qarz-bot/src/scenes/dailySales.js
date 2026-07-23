import { t, money } from '../lib/i18n.js';
import { api } from '../lib/api.js';
import { sessions } from '../lib/sessions.js';
import { cancelKeyboard, mainMenu } from '../keyboards/index.js';

/**
 * Ask for today's cash/card sales; backend adds same-day debts automatically.
 */
export async function dailySalesConversation(conversation, ctx) {
  const tgId = ctx.from.id;
  const sess = sessions.get(tgId);
  const lang = sess?.lang || 'uz';

  if (!sess?.accessToken) {
    await ctx.reply(t('session_expired', lang));
    return;
  }

  let cash;
  while (true) {
    await ctx.reply(t('ask_daily_cash', lang), { reply_markup: cancelKeyboard(lang) });
    const msg = await conversation.waitFor('message:text');
    const text = msg.message.text;
    if (text === t('cancel_btn', lang) || text === '/cancel') {
      await ctx.reply(t('cancelled', lang), { reply_markup: mainMenu(lang, sess.role) });
      return;
    }
    const parsed = Number(text.replace(/[^\d.]/g, ''));
    if (parsed >= 0 && text.trim() !== '') { cash = parsed; break; }
    await ctx.reply(t('ask_amount_invalid', lang));
  }

  try {
    const result = await conversation.external(() =>
      api.dailySales(tgId, cash)
    );
    await ctx.reply(
      t('daily_saved', lang, {
        cash: money(result.cash_card),
        debt: money(result.debt_given),
        total: money(result.total),
      }),
      { parse_mode: 'HTML', reply_markup: mainMenu(lang, sess.role) }
    );
  } catch (err) {
    await ctx.reply(
      err?.code === 'SESSION_EXPIRED'
        ? t('session_expired', lang)
        : t('error_generic', lang, { msg: err.message }),
      { reply_markup: mainMenu(lang, sess.role) }
    );
  }
}
