import { t } from '../lib/i18n.js';
import { api } from '../lib/api.js';
import { sessions } from '../lib/sessions.js';
import { mainMenu, cancelKeyboard } from '../keyboards/index.js';

/**
 * Two-step Telegram linking.
 *
 * The phone has already been shared (stored as `pendingPhone`) and the backend
 * has sent a 6-digit SMS code. Here we collect the code and confirm the link.
 * Only after a valid code does the backend issue tokens — sharing a contact
 * alone is no longer enough to take over an account.
 */
export async function linkOtpConversation(conversation, ctx) {
  const tgId = ctx.from.id;
  const sess = sessions.get(tgId) || {};
  const lang = sess.lang || 'uz';
  const phone = sess.pendingPhone;

  if (!phone) {
    await ctx.reply(t('reg_need_contact', lang));
    return;
  }

  await ctx.reply(t('otp_sent', lang, { phone }), {
    parse_mode: 'HTML',
    reply_markup: cancelKeyboard(lang),
  });

  // up to 5 tries; the backend enforces its own attempt cap too
  for (let i = 0; i < 5; i++) {
    const msg = await conversation.waitFor('message:text');
    const text = msg.message.text.trim();

    if (text === t('cancel_btn', lang) || text === '/cancel') {
      sessions.set(tgId, { pendingPhone: undefined });
      await ctx.reply(t('otp_cancelled', lang));
      return;
    }

    const code = text.replace(/\D/g, '');
    if (code.length !== 6) {
      await ctx.reply(t('otp_ask_again', lang));
      continue;
    }

    try {
      const res = await conversation.external(() =>
        api.confirmTelegramLink(phone, tgId, code)
      );

      const role = res.user?.role || 'personal';
      sessions.set(tgId, {
        accessToken: res.tokens?.accessToken,
        refreshToken: res.tokens?.refreshToken,
        role,
        phone,
        pendingPhone: undefined,
      });

      const key = role === 'shop_owner' ? 'linked_owner' : 'linked_personal';
      await ctx.reply(t(key, lang), {
        parse_mode: 'HTML',
        reply_markup: mainMenu(lang, role),
      });
      return;
    } catch (err) {
      // wrong/expired code: report and let the loop ask again
      await ctx.reply(t('otp_bad', lang, { msg: err.message }));
      if (err.code === 'OTP_LOCKED' || err.code === 'OTP_EXPIRED') {
        sessions.set(tgId, { pendingPhone: undefined });
        return;
      }
    }
  }

  sessions.set(tgId, { pendingPhone: undefined });
  await ctx.reply(t('otp_cancelled', lang));
}
