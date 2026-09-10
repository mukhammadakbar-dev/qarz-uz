import { Keyboard, InlineKeyboard } from 'grammy';
import { t } from '../lib/i18n.js';

export const contactKeyboard = (lang) =>
  new Keyboard()
    .requestContact(t('share_contact_btn', lang))
    .resized()
    .oneTime();

export const mainMenu = (lang) => {
  const kb = new Keyboard()
    .text(t('menu_add_debt', lang))
    .text(t('menu_reduce_debt', lang))
    .row()
    .text(t('menu_lang', lang))
    .text(t('menu_ai', lang));
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
