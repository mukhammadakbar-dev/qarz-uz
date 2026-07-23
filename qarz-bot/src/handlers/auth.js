import { t } from '../lib/i18n.js';
import { api } from '../lib/api.js';
import { sessions } from '../lib/sessions.js';
import { contactKeyboard, mainMenu } from '../keyboards/index.js';

/**
 * /start — greet and, if not authed, request the contact.
 */
export const handleStart = async (ctx) => {
  const tgId = ctx.from.id;
  const sess = sessions.get(tgId);
  const lang = sess?.lang || 'uz';

  if (sessions.isAuthed(tgId)) {
    await ctx.reply(t('menu_title', lang), {
      reply_markup: mainMenu(lang, sess.role),
    });
    return;
  }

  sessions.set(tgId, { lang });
  await ctx.reply(t('welcome', lang), {
    parse_mode: 'HTML',
    reply_markup: contactKeyboard(lang),
  });
};

/**
 * Contact shared → step 1 of linking: ask the backend to SMS a one-time code.
 *
 * Sharing a contact is NOT proof of ownership (a contact card can be forwarded
 * or fabricated), so no tokens are issued here. The OTP conversation that
 * follows is what actually proves the user controls the number.
 */
export const handleContact = async (ctx) => {
  const tgId = ctx.from.id;
  const sess = sessions.get(tgId) || {};
  const lang = sess.lang || 'uz';

  const contact = ctx.message.contact;
  // only accept the user's own contact, never a forwarded one
  if (contact.user_id && contact.user_id !== tgId) {
    await ctx.reply(t('reg_need_contact', lang), { reply_markup: contactKeyboard(lang) });
    return;
  }

  const phone = contact.phone_number.startsWith('+')
    ? contact.phone_number
    : '+' + contact.phone_number;

  sessions.set(tgId, { pendingPhone: phone });

  try {
    // Always returns {sent:true} — the backend deliberately does not reveal
    // whether an account exists, so we cannot branch on it here.
    await api.requestTelegramLink(phone);
    await ctx.conversation.enter('linkOtp');
  } catch (err) {
    await ctx.reply(t('error_generic', lang, { msg: err.message }));
  }
};
