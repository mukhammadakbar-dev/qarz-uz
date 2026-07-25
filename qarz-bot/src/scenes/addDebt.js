import { InlineKeyboard } from 'grammy';
import { t, money } from '../lib/i18n.js';
import { api } from '../lib/api.js';
import { sessions } from '../lib/sessions.js';
import { cancelKeyboard, mainMenu } from '../keyboards/index.js';

const isCancel = (text, lang) => text === t('cancel_btn', lang) || text === '/cancel';

/**
 * Guided flow: name -> (match existing?) -> phone -> amount -> due -> note.
 *
 * Before creating a debtor we search for existing ones so repeat customers
 * don't accumulate duplicate records.
 */
export async function addDebtConversation(conversation, ctx) {
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
        reply_markup: mainMenu(lang, sess.role),
      });
    }
  };

  // 1) Debtor name
  await ctx.reply(t('ask_debtor_name', lang), { reply_markup: cancelKeyboard(lang) });
  let msg = await conversation.waitFor('message:text');
  if (isCancel(msg.message.text, lang)) return endCancelled(ctx, lang, sess);
  const fullName = msg.message.text.trim();

  // 2) Look for an existing debtor with a similar name
  let debtorId = null;
  let matches = [];
  try {
    matches = await conversation.external(() =>
      api.listDebtors(tgId, { search: fullName })
    );
  } catch (err) {
    if (err?.code === 'SESSION_EXPIRED') return fail(err);
    matches = []; // search is best-effort; fall through to creating a new debtor
  }

  if (Array.isArray(matches) && matches.length > 0) {
    const kb = new InlineKeyboard();
    matches.slice(0, 5).forEach((m, i) => {
      const label = t('dup_option', lang, {
        name: m.full_name,
        phone: m.phone ? ` (${m.phone})` : '',
        outstanding: money(m.outstanding || 0),
      });
      kb.text(label, `pick:${m.id}`).row();
      if (i === matches.length - 1) kb.row();
    });
    kb.text(t('dup_new_btn', lang), 'pick:new');

    await ctx.reply(t('dup_found', lang), { reply_markup: kb });
    const cq = await conversation.waitFor('callback_query:data');
    await cq.answerCallbackQuery();
    const choice = cq.callbackQuery.data.split(':')[1];
    if (choice !== 'new') debtorId = choice;
  }

  // 3) Phone — only needed when creating a new debtor
  let phone;
  if (!debtorId) {
    await ctx.reply(t('ask_debtor_phone', lang));
    msg = await conversation.waitFor('message:text');
    if (isCancel(msg.message.text, lang)) return endCancelled(ctx, lang, sess);
    const raw = msg.message.text.trim();
    phone = raw === '-' ? undefined : raw;
  }

  // 3b) Direction — only meaningful for personal (free) users, who track a
  // two-way ledger. Shop owners only ever record debts owed TO the shop.
  let direction = 'given';
  if (sess.role === 'personal') {
    const kb = new InlineKeyboard()
      .text(t('dir_given', lang), 'dir:given')
      .text(t('dir_taken', lang), 'dir:taken');
    await ctx.reply(t('ask_direction', lang), { reply_markup: kb });
    const cq = await conversation.waitFor('callback_query:data');
    await cq.answerCallbackQuery();
    direction = cq.callbackQuery.data.split(':')[1] === 'taken' ? 'taken' : 'given';
  }

  // 4) Amount
  let amount;
  while (true) {
    await ctx.reply(t('ask_amount', lang));
    msg = await conversation.waitFor('message:text');
    if (isCancel(msg.message.text, lang)) return endCancelled(ctx, lang, sess);
    const parsed = Number(msg.message.text.replace(/[^\d.]/g, ''));
    if (parsed > 0) { amount = parsed; break; }
    await ctx.reply(t('ask_amount_invalid', lang));
  }

  // 5) Due date
  let dueDate;
  while (true) {
    await ctx.reply(t('ask_due_date', lang));
    msg = await conversation.waitFor('message:text');
    if (isCancel(msg.message.text, lang)) return endCancelled(ctx, lang, sess);
    const val = msg.message.text.trim();
    if (val === '-') { dueDate = undefined; break; }
    if (/^\d{4}-\d{2}-\d{2}$/.test(val) && !isNaN(Date.parse(val))) { dueDate = val; break; }
    await ctx.reply(t('ask_due_invalid', lang));
  }

  // 6) Note
  await ctx.reply(t('ask_note', lang));
  msg = await conversation.waitFor('message:text');
  if (isCancel(msg.message.text, lang)) return endCancelled(ctx, lang, sess);
  const noteRaw = msg.message.text.trim();
  const note = noteRaw === '-' ? undefined : noteRaw;

  // --- Persist ---
  try {
    if (!debtorId) {
      const debtor = await conversation.external(() =>
        api.createDebtor(tgId, { fullName, phone })
      );
      debtorId = debtor.id;
    }
    await conversation.external(() =>
      api.addDebt(tgId, { debtorId, direction, amount, dueDate, note })
    );
    await ctx.reply(
      t('debt_created', lang, {
        name: fullName,
        amount: money(amount),
        due: dueDate || '—',
      }),
      { parse_mode: 'HTML', reply_markup: mainMenu(lang, sess.role) }
    );
  } catch (err) {
    await fail(err);
  }
}

const endCancelled = async (ctx, lang, sess) => {
  await ctx.reply(t('cancelled', lang), { reply_markup: mainMenu(lang, sess?.role) });
};
