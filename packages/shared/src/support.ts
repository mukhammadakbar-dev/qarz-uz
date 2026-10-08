import type { Locale } from './locale.js';

/**
 * Obunani uzaytirish uchun admin bilan chat (to'lov qo'lda, ADR-0005).
 * Havola admin chatini telefon raqami bo'yicha ochadi va xabarni oldindan yozib qo'yadi (`t.me/+<raqam>?text=`):
 * foydalanuvchi faqat "Yuborish"ni bosadi, admin esa biznes kodini (`/extend <kod>` uchun) darhol ko'radi.
 */

const REQUEST: Record<Locale, (code: string) => string> = {
  'uz-Latn': (code) => `Assalomu alaykum! Obuna muddatini uzaytirmoqchiman. ID: \`${code}\``,
  'uz-Cyrl': (code) => `Ассалому алайкум! Обуна муддатини узайтирмоқчиман. ID: \`${code}\``,
};

export const subscriptionRequestText = (locale: Locale, businessCode: string): string =>
  REQUEST[locale](businessCode);

/** `+998907900110` (yoki `998907900110`) → `https://t.me/+998907900110?text=...`. */
export function supportChatUrl(phone: string, text?: string): string {
  const digits = phone.replace(/\D/g, '');
  const base = `https://t.me/+${digits}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/** Obuna uzaytirish so'rovi bilan admin chatiga havola. */
export const subscriptionRequestUrl = (phone: string, locale: Locale, businessCode: string) =>
  supportChatUrl(phone, subscriptionRequestText(locale, businessCode));
