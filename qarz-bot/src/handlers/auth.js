import { t } from '../lib/i18n.js';
import { api } from '../lib/api.js';
import { sessions } from '../lib/sessions.js';
import { contactKeyboard, mainMenu } from '../keyboards/index.js';

/**
 * /start — greet and, if not authed, request the contact.
 */
export const handleStart = async (ctx) => {
  const tgId = ctx.from.id;
  const match = ctx.match || '';

  const sess = sessions.get(tgId);
  const lang = sess?.lang || 'uz';

  // Deep-link registration verification (/start verify_<token>).
  //
  // The token alone proves nothing — whoever started the registration holds it,
  // and that may not be the owner of the phone number. So we ask for a contact
  // card here and let the backend check it against the number the registration
  // was started for; only Telegram can vouch for that number.
  if (typeof match === 'string' && match.startsWith('verify_')) {
    const token = match.slice('verify_'.length);
    if (!/^[a-f0-9]{64}$/.test(token)) {
      await ctx.reply(t('verify_err_msg', lang, { msg: 'token yaroqsiz' }));
      return;
    }
    sessions.set(tgId, { lang, pendingVerifyToken: token });
    await ctx.reply(t('verify_ask_contact', lang), {
      parse_mode: 'HTML',
      reply_markup: contactKeyboard(lang),
    });
    return;
  }

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

  // A web registration is waiting on this contact to prove the number is ours.
  if (sess.pendingVerifyToken) {
    const token = sess.pendingVerifyToken;
    sessions.set(tgId, { pendingVerifyToken: undefined });
    try {
      await api.confirmVerifyToken(token, tgId, phone);
      await ctx.reply(t('verify_ok_msg', lang), { parse_mode: 'HTML' });
    } catch (err) {
      await ctx.reply(t('verify_err_msg', lang, { msg: err.message }));
    }
    return;
  }

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
      // New user: store pendingPhone and trigger interactive onboarding
      sessions.set(tgId, { pendingPhone: phone, lang });
      await ctx.conversation.enter('register');
    }
  } catch (err) {
    await ctx.reply(t('error_generic', lang, { msg: err.message }));
  }
};
