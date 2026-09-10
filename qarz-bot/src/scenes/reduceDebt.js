import { InlineKeyboard } from 'grammy';
import { t, money } from '../lib/i18n.js';
import { api } from '../lib/api.js';
import { sessions } from '../lib/sessions.js';
import { cancelKeyboard, mainMenu } from '../keyboards/index.js';

const isCancel = (text, lang) => text === t('cancel_btn', lang) || text === '/cancel';

export async function reduceDebtConversation(conversation, ctx) {
  const tgId = ctx.from.id;
  const sess = sessions.get(tgId);
  const lang = sess?.lang || 'uz';

  if (!sess?.accessToken) {
    await ctx.reply(t('session_expired', lang));
    return;
  }

  const fail = async (err) => {
    if (err?.code === 'SESSION_EXPIRED') {
      await ctx.reply(t('session_expired', lang));
    } else {
      await ctx.reply(t('error_generic', lang, { msg: err.message }), {
        reply_markup: mainMenu(lang, sess?.role),
      });
    }
  };

  // 1) Fetch list of debtors with open debt
  let debtors = [];
  try {
    debtors = await conversation.external(() =>
      api.listDebtors(tgId, { filter: 'with_debt' })
    );
  } catch (err) {
    return fail(err);
  }

  if (!debtors || debtors.length === 0) {
    await ctx.reply(t('debtors_empty', lang), {
      reply_markup: mainMenu(lang, sess?.role),
    });
    return;
  }

  // 2) Render debtor picker inline keyboard
  const kb = new InlineKeyboard();
  debtors.slice(0, 10).forEach((d) => {
    kb.text(`${d.full_name} (${money(d.outstanding)})`, `reduce:${d.id}`).row();
  });

  await ctx.reply(t('ask_reduce_debtor', lang), {
    reply_markup: kb,
  });

  const pickCq = await conversation.waitFor('callback_query:data');
  await pickCq.answerCallbackQuery();
  const debtorId = pickCq.callbackQuery.data.split(':')[1];
  const selectedDebtor = debtors.find((d) => d.id === debtorId);
  const fullName = selectedDebtor?.full_name || 'Mijoz';
  const currentOutstanding = Number(selectedDebtor?.outstanding || 0);

  // 3) Ask for reduction amount
  let amount = 0;
  while (true) {
    await ctx.reply(
      t('ask_reduce_amount', lang, {
        name: fullName,
        outstanding: money(currentOutstanding),
      }),
      {
        parse_mode: 'HTML',
        reply_markup: cancelKeyboard(lang),
      }
    );

    const msg = await conversation.waitFor('message:text');
    if (isCancel(msg.message.text, lang)) {
      await ctx.reply(t('cancelled', lang), {
        reply_markup: mainMenu(lang, sess?.role),
      });
      return;
    }

    const parsed = Number(msg.message.text.replace(/[^\d.]/g, ''));
    if (parsed > 0) {
      amount = parsed;
      break;
    }
    await ctx.reply(t('reduce_amount_invalid', lang));
  }

  // 4) Execute payments against debtor's open debts
  try {
    const debts = await conversation.external(() =>
      api.debtorHistory(tgId, debtorId)
    );

    const openDebts = (debts || [])
      .filter((d) => d.status !== 'paid')
      .sort((a, b) => new Date(a.created_at || a.issued_at) - new Date(b.created_at || b.issued_at));

    if (openDebts.length === 0) {
      await ctx.reply(t('no_debt_to_reduce', lang), {
        reply_markup: mainMenu(lang, sess?.role),
      });
      return;
    }

    let remainingToPay = amount;
    for (const d of openDebts) {
      if (remainingToPay <= 0) break;

      const debtTotal = Number(d.amount);
      const debtPaid = Number(d.paid_amount || 0);
      const debtUnpaid = debtTotal - debtPaid;

      if (debtUnpaid <= 0) continue;

      const payNow = Math.min(remainingToPay, debtUnpaid);

      await conversation.external(() =>
        api.payDebt(tgId, d.id, { amount: payNow, method: 'manual' })
      );

      remainingToPay -= payNow;
    }

    const newOutstanding = Math.max(0, currentOutstanding - amount);

    await ctx.reply(
      t('reduce_success', lang, {
        name: fullName,
        amount: money(amount),
        remaining: money(newOutstanding),
      }),
      {
        parse_mode: 'HTML',
        reply_markup: mainMenu(lang, sess?.role),
      }
    );
  } catch (err) {
    await fail(err);
  }
}
