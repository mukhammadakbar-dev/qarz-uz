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
 * Contact shared → login or auto-register user directly in Telegram Bot.
 */
export const handleContact = async (ctx) => {
  const tgId = ctx.from.id;
  const sess = sessions.get(tgId) || {};
  const lang = sess.lang || 'uz';

  const contact = ctx.message.contact;
  // only accept the user's own contact
  if (contact.user_id && contact.user_id !== tgId) {
    await ctx.reply(t('reg_need_contact', lang), { reply_markup: contactKeyboard(lang) });
    return;
  }

  const phone = contact.phone_number.startsWith('+')
    ? contact.phone_number
    : '+' + contact.phone_number;

  try {
    const res = await api.directLinkByContact(phone, tgId);
    if (res.exists) {
      const role = res.user?.role || 'personal';
      sessions.set(tgId, {
        accessToken: res.tokens?.accessToken,
        refreshToken: res.tokens?.refreshToken,
        role,
        phone,
      });

      await ctx.reply(`✅ <b>Hush kelibsiz! Akkauntingiz muvaffaqiyatli bog'landi.</b>`, {
        parse_mode: 'HTML',
        reply_markup: mainMenu(lang, role),
      });
    } else {
      // New user -> proceed to bot registration conversation
      sessions.set(tgId, { pendingPhone: phone, lang });
      await ctx.conversation.enter('register');
    }
  } catch (err) {
    await ctx.reply(t('error_generic', lang, { msg: err.message }));
  }
};
