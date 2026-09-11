import { InlineKeyboard } from 'grammy';
import { parseNaturalLanguage } from '../lib/ai.js';
import { api } from '../lib/api.js';
import { sessions } from '../lib/sessions.js';
import { t, money } from '../lib/i18n.js';
import { mainMenu } from '../keyboards/index.js';
import { handleStart } from './auth.js';

// Temporary memory store for pending AI debt confirmations
const pendingAiActions = new Map();

/** Clean up stale pending actions older than 30 minutes */
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [key, val] of pendingAiActions.entries()) {
    if (val.timestamp < cutoff) pendingAiActions.delete(key);
  }
}, 5 * 60 * 1000).unref();

/** Primary handler for natural language messages */
export const handleAiMessage = async (ctx, overrideText) => {
  const tgId = ctx.from.id;
  const sess = sessions.get(tgId);
  const lang = sess?.lang || 'uz';

  if (!sessions.isAuthed(tgId)) {
    return handleStart(ctx);
  }

  // grammY calls handlers as (ctx, next), so only a string counts as override.
  const text = typeof overrideText === 'string' ? overrideText : ctx.message?.text;
  if (!text) return;

  try {
    const parsed = await parseNaturalLanguage(text, new Date());

    if (parsed.intent === 'ADD_DEBT') {
      const { debtorName, amount, dueDate, dueLabel, direction, note } = parsed;

      // Handle missing required fields gracefully
      if (!debtorName && !amount) {
        return ctx.reply(
          `🤖 <b>AI Yordamchi:</b> Qarz yozish uchun mijoz ismi va summani kiriting.\n\n` +
          `<i>Masalan:</i> <code>Ali 100ming som dushanba</code> yoki <code>Vali 500.000 juma nos sotib oldi</code>`,
          { parse_mode: 'HTML' }
        );
      }

      if (!debtorName) {
        return ctx.reply(
          `🤖 <b>AI Yordamchi:</b> Qarz summasi topildi (<b>${money(amount)}</b>), lekin mijoz ismi aniqlanmadi.\n\n` +
          `<i>Masalan:</i> <code>Falonchi ${amount} so'm dushanba</code>`,
          { parse_mode: 'HTML' }
        );
      }

      if (!amount || amount <= 0) {
        return ctx.reply(
          `🤖 <b>AI Yordamchi:</b> Mijoz ismi topildi (<b>${debtorName}</b>), lekin qarz summasi aniqlanmadi.\n\n` +
          `<i>Masalan:</i> <code>${debtorName} 100.000 so'm dushanba</code>`,
          { parse_mode: 'HTML' }
        );
      }

      // Search database for existing debtor
      let matchedDebtor = null;
      try {
        const matches = await api.listDebtors(tgId, { search: debtorName });
        if (Array.isArray(matches) && matches.length > 0) {
          // Exact or best name match
          matchedDebtor = matches.find(
            (m) => m.full_name.toLowerCase() === debtorName.toLowerCase()
          ) || matches[0];
        }
      } catch (err) {
        console.warn('[aiHandler] Debtor search failed:', err.message);
      }

      const finalFullName = matchedDebtor ? matchedDebtor.full_name : debtorName;
      const pendingId = `ai_${tgId}_${Date.now()}`;

      pendingAiActions.set(pendingId, {
        tgId,
        debtorId: matchedDebtor ? matchedDebtor.id : null,
        fullName: finalFullName,
        amount,
        dueDate,
        dueLabel,
        direction: direction || 'given',
        note: note || '',
        timestamp: Date.now(),
      });

      const kb = new InlineKeyboard()
        .text('✅ Tasdiqlash va saqlash', `ai:confirm:${pendingId}`)
        .text('❌ Bekor qilish', `ai:cancel:${pendingId}`);

      const debtorStatus = matchedDebtor
        ? ` (Bazadan topildi 👤)`
        : ` (Yangi mijoz ➕)`;

      const directionText = direction === 'taken' ? 'Qarz olindi 📥' : 'Qarz berildi 📤';
      const dueDisplay = dueLabel || (dueDate ? dueDate : 'Kiritilmadi (—)');

      const confirmationText =
        `🤖 <b>AI Yordamchi: Qarz ma'lumotlari aniqlandi</b>\n\n` +
        `👤 <b>Mijoz:</b> <b>${finalFullName}</b>${debtorStatus}\n` +
        `💰 <b>Qarz summasi:</b> <b>${money(amount)}</b>\n` +
        `📅 <b>Qaytarish muddati:</b> <b>${dueDisplay}</b>\n` +
        `↔️ <b>Turi:</b> ${directionText}\n` +
        (note ? `📝 <b>Izoh:</b> ${note}\n` : '') +
        `\n<i>Qarzni saqlashni tasdiqlaysizmi?</i>`;

      return ctx.reply(confirmationText, {
        parse_mode: 'HTML',
        reply_markup: kb,
      });
    }

    if (parsed.intent === 'SEARCH_DEBTOR' && parsed.debtorName) {
      const debtors = await api.listDebtors(tgId, { search: parsed.debtorName });
      if (!debtors || debtors.length === 0) {
        return ctx.reply(`🤖 <b>AI Yordamchi:</b> "${parsed.debtorName}" ismli qarzdor topilmadi.`, {
          parse_mode: 'HTML',
        });
      }
      const d = debtors[0];
      return ctx.reply(
        `🤖 <b>AI Yordamchi:</b>\n👤 <b>${d.full_name}</b>\n💰 Qarz qoldig'i: <b>${money(d.outstanding || 0)}</b>`,
        { parse_mode: 'HTML' }
      );
    }

    // Default friendly AI assistance message
    return ctx.reply(
      `🤖 <b>AI Yordamchi</b>\n\n` +
      `Siz botga shunchaki matn ko'rinishida buyruq berishingiz mumkin.\n\n` +
      `<b>Misollar:</b>\n` +
      `• <code>Ali 100ming som dushanba</code>\n` +
      `• <code>Vali 500.000 juma nos sotib oldi</code>\n` +
      `• <code>Sardor 1.5 mln kelasi hafta</code>`,
      { parse_mode: 'HTML', reply_markup: mainMenu(lang, sess.role) }
    );
  } catch (err) {
    console.error('[aiHandler] Error processing message:', err);
    return ctx.reply(t('error_generic', lang, { msg: err.message }));
  }
};

/** AI user guide and interactive demo handler */
export const handleAiGuide = async (ctx) => {
  const tgId = ctx.from?.id;
  const sess = sessions.get(tgId);
  const lang = sess?.lang || 'uz';

  const kb = new InlineKeyboard().text(t('ai_demo_btn', lang), 'ai:demo');

  return ctx.reply(t('ai_guide_text', lang), {
    parse_mode: 'HTML',
    reply_markup: kb,
  });
};

/** Callback query handler for AI confirmation buttons */
export const handleAiCallback = async (ctx) => {
  const tgId = ctx.from.id;
  const sess = sessions.get(tgId);
  const lang = sess?.lang || 'uz';
  const data = ctx.callbackQuery.data;

  const [, action, pendingId] = data.split(':');
  await ctx.answerCallbackQuery();

  if (action === 'demo') {
    const demoText = lang === 'ru' ? 'Али 100тыс сум понедельник' : 'Ali 100ming som dushanba';
    await ctx.reply(t('ai_demo_success', lang), { parse_mode: 'HTML' });
    // ctx.message is a getter-only property on grammY's Context, so the demo
    // text is handed over directly instead of being assigned onto ctx.
    return handleAiMessage(ctx, demoText);
  }

  if (action === 'cancel') {
    pendingAiActions.delete(pendingId);
    try {
      await ctx.editMessageText('❌ AI buyruq bekor qilindi.');
    } catch {
      await ctx.reply('❌ AI buyruq bekor qilindi.');
    }
    return;
  }

  if (action === 'confirm') {
    const item = pendingAiActions.get(pendingId);
    if (!item) {
      return ctx.reply('⚠️ Ushbu so\'rov muddati tugagan. Iltimos, qayta yuboring.');
    }

    pendingAiActions.delete(pendingId);

    try {
      let debtorId = item.debtorId;
      if (!debtorId) {
        // Create new debtor
        const newDebtor = await api.createDebtor(tgId, { fullName: item.fullName });
        debtorId = newDebtor.id;
      }

      await api.addDebt(tgId, {
        debtorId,
        direction: item.direction,
        amount: item.amount,
        dueDate: item.dueDate || undefined,
        note: item.note || undefined,
      });

      const captionText = t('debt_created', lang, {
        name: item.fullName,
        amount: money(item.amount),
        due: item.dueDate || '—',
      });

      try {
        await ctx.deleteMessage();
      } catch {
        // ignore if message cannot be deleted
      }

      await ctx.reply(`✅ <b>AI yordamida saqlandi!</b>\n\n${captionText}`, {
        parse_mode: 'HTML',
        reply_markup: mainMenu(lang, sess.role),
      });

    } catch (err) {
      console.error('[aiHandler] Error confirming debt:', err);
      return ctx.reply(t('error_generic', lang, { msg: err.message }));
    }
  }
};
