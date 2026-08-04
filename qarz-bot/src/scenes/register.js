import { randomBytes } from 'crypto';
import { InlineKeyboard } from 'grammy';
import { t } from '../lib/i18n.js';
import { api } from '../lib/api.js';
import { sessions } from '../lib/sessions.js';
import { mainMenu, contactKeyboard } from '../keyboards/index.js';

/**
 * Interactive registration from Telegram bot (Zero password prompt):
 * 1) Choose Role (Shop Owner vs Personal User)
 * 2) Enter Full Name
 * 3) Enter Shop Name (if Shop Owner)
 * Password is generated automatically so Telegram registration requires NO password prompt!
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

  // Step 1: Purpose / Role choice
  const roleKb = new InlineKeyboard()
    .text(t('reg_role_shop', lang), 'role:shop_owner').row()
    .text(t('reg_role_personal', lang), 'role:personal');

  await ctx.reply(
    `<b>${t('reg_ask_purpose', lang)}</b>\n\n` +
    `• <b>${t('reg_role_shop', lang)}:</b> ${t('reg_desc_shop', lang)}\n` +
    `• <b>${t('reg_role_personal', lang)}:</b> ${t('reg_desc_personal', lang)}`,
    { parse_mode: 'HTML', reply_markup: roleKb }
  );

  const roleCq = await conversation.waitFor('callback_query:data');
  await roleCq.answerCallbackQuery();
  const selectedRole = roleCq.callbackQuery.data.split(':')[1];

  // Step 2: Full Name
  await ctx.reply(t('reg_ask_name', lang));
  let msg = await conversation.waitFor('message:text');
  const fullName = msg.message.text.trim();

  // Step 3: Shop Name (only for shop owners)
  let shopName = '';
  if (selectedRole === 'shop_owner') {
    await ctx.reply(t('reg_ask_shopname', lang));
    msg = await conversation.waitFor('message:text');
    shopName = msg.message.text.trim();
  }

  // Auto-generate the internal password (no prompt needed in Telegram).
  // Math.random() is not a CSPRNG and its state is recoverable from previous
  // outputs, which would make these passwords predictable across registrations.
  const password = 'tg-' + randomBytes(18).toString('base64url') + 'A1!';

  try {
    let res;
    if (selectedRole === 'shop_owner') {
      res = await conversation.external(() =>
        api.registerShop(phone, password, fullName, shopName, tgId)
      );
    } else {
      res = await conversation.external(() =>
        api.registerPersonal(phone, password, fullName, tgId)
      );
    }

    const role = res.user?.role || selectedRole;
    sessions.set(tgId, {
      accessToken: res.accessToken,
      refreshToken: res.refreshToken,
      role,
      phone,
      pendingPhone: undefined,
    });

    const roleLabel = role === 'shop_owner' ? `${t('reg_role_shop', lang)} (${shopName})` : t('reg_role_personal', lang);

    await ctx.reply(
      t('reg_success_msg', lang, {
        name: fullName,
        phone,
        roleLabel,
      }),
      {
        parse_mode: 'HTML',
        reply_markup: mainMenu(lang, role),
      }
    );
  } catch (err) {
    await ctx.reply(t('error_generic', lang, { msg: err.message }));
  }
}
