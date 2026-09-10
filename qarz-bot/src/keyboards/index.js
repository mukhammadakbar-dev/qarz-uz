import { Keyboard, InlineKeyboard } from 'grammy';
import { t } from '../lib/i18n.js';
import { config } from '../lib/config.js';

export const contactKeyboard = (lang) =>
  new Keyboard()
    .requestContact(t('share_contact_btn', lang))
    .resized()
    .oneTime();

export const mainMenu = (lang, role) => {
  const kb = new Keyboard()
    .text(t('menu_ai', lang))
    .row()
    .text(t('menu_add_debt', lang))
    .text(t('menu_debtors', lang))
    .row();
  // Telegram only accepts an https:// url on a web_app button and silently
  // drops the button otherwise, so this stays absent rather than broken until
  // WEB_APP_URL is actually a public HTTPS deployment.
  if (config.webAppUrl) {
    kb.webApp(t('menu_webapp', lang), config.webAppUrl).row();
  }
  // shop-owner-only features
  if (role === 'shop_owner' || role === 'staff') {
    kb.text(t('menu_dashboard', lang)).text(t('menu_daily_sales', lang)).row();
  }
  // Paying for the subscription is the owner's job — staff cannot renew it, so
  // showing them the button would only lead to a dead end.
  if (role === 'shop_owner') {
    kb.text(t('menu_subscription', lang)).row();
  }
  kb.text(t('menu_lang', lang));
  return kb.resized();
};

export const cancelKeyboard = (lang) =>
  new Keyboard().text(t('cancel_btn', lang)).resized().oneTime();

export const langKeyboard = () =>
  new InlineKeyboard()
    .text('🇺🇿 O\'zbekcha', 'lang:uz')
    .text('🇷🇺 Русский', 'lang:ru');

/** Inline keyboard for a single debtor's quick actions */
export const debtorActions = (lang, debtorId) =>
  new InlineKeyboard()
    .text('📜', `history:${debtorId}`)
    .text('➕', `adddebt:${debtorId}`);
