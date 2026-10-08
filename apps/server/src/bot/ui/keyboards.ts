import { InlineKeyboard, Keyboard } from 'grammy';
import { LOCALES, t, type MessageKey } from '../../i18n/index.js';
import type { Button } from './render.js';

/**
 * Pastki doimiy klaviatura (reply keyboard): Mini App ochilmaganda ham eng kerakli amallar.
 * Tugma bosilganda Telegram uning MATNINI yuboradi, shuning uchun matn ikkala yozuvda ham taniladi
 * (foydalanuvchi tilni almashtirgan, eski klaviatura hali ekranda bo'lishi mumkin).
 */
export const MAIN_KEYS = [
  'kb.debt',
  'kb.payment',
  'kb.debtors',
  'kb.subscription',
  'kb.lang',
  'kb.guide',
] as const satisfies readonly MessageKey[];

export type MainKey = (typeof MAIN_KEYS)[number];

export function mainKeyboard(ctx: { t: (k: MessageKey) => string }): Keyboard {
  return new Keyboard()
    .text(ctx.t('kb.debt'))
    .text(ctx.t('kb.payment'))
    .row()
    .text(ctx.t('kb.debtors'))
    .text(ctx.t('kb.subscription'))
    .row()
    .text(ctx.t('kb.lang'))
    .text(ctx.t('kb.guide'))
    .resized()
    .persistent();
}

const byText = new Map<string, MainKey>(
  MAIN_KEYS.flatMap((key) => LOCALES.map((l) => [t(l, key), key] as const)),
);

/** Matn klaviatura tugmasimi? Bo'lsa qaysi biri. */
export const matchMainKey = (text: string): MainKey | null => byText.get(text.trim()) ?? null;

/** Toza tugma tavsifini (render.ts) grammY inline klaviaturasiga aylantiradi. */
export function toKeyboard(buttons: readonly (readonly Button[])[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const row of buttons) {
    for (const b of row) {
      if (b.webAppUrl) kb.webApp(b.text, b.webAppUrl);
      else kb.text(b.text, b.data);
    }
    kb.row();
  }
  return kb;
}
