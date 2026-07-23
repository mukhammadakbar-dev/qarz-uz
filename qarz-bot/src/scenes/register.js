import { t } from '../lib/i18n.js';
import { api } from '../lib/api.js';
import { sessions } from '../lib/sessions.js';
import { mainMenu, contactKeyboard } from '../keyboards/index.js';

/**
 * Register a NEW personal (free) user from Telegram.
 * Requires that the phone was shared first (stored in a pending slot).
 */
export async function registerConversation(conversation, ctx) {
  const tgId = ctx.from.id;
  const sess = sessions.get(tgId) || {};
  const lang = sess.lang || 'uz';

  const phone = sess.pendingPhone;
  if (!phone) {
    await ctx.reply(t('reg_need_contact', lang), { reply_markup: contactKeyboard(lang) });
    return;
  }

  await ctx.reply(t('reg_ask_name', lang));
  let msg = await conversation.waitFor('message:text');
  const fullName = msg.message.text.trim();

  let password;
  while (true) {
    await ctx.reply(t('reg_ask_password', lang));
    msg = await conversation.waitFor('message:text');
    if (msg.message.text.trim().length >= 6) { password = msg.message.text.trim(); break; }
    await ctx.reply(t('reg_ask_password', lang));
  }

  try {
    // create the personal account
    await conversation.external(() => api.registerPersonal(phone, password, fullName));

    // Link Telegram through the verified OTP flow rather than trusting the
    // shared contact: request a code, then hand off to the OTP conversation.
    await conversation.external(() => api.requestTelegramLink(phone));
    await ctx.reply(t('reg_done', lang));
    await ctx.conversation.enter('linkOtp');
  } catch (err) {
    await ctx.reply(t('error_generic', lang, { msg: err.message }));
  }
}
