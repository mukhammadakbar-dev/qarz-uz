import type { Locale } from './locale.js';

/**
 * Pul (ADR-0002 §1): butun so'm, `number` (xavfsiz butun son; 10 mlrd << 2^53). Float hech qayerda.
 * DB'da BIGINT. Bitta yozuv chegarasi shu yerda va DB CHECK'da bir xil.
 */
export const MIN_AMOUNT_UZS = 1;
export const MAX_AMOUNT_UZS = 10_000_000_000;
/** Shu summadan boshlab (inklyuziv) tasdiqlashda alohida ogohlantirish chiqadi. */
export const LARGE_AMOUNT_UZS = 50_000_000;

export const isValidAmount = (n: number): boolean =>
  Number.isSafeInteger(n) && n >= MIN_AMOUNT_UZS && n <= MAX_AMOUNT_UZS;

export const isLargeAmount = (n: number): boolean => n >= LARGE_AMOUNT_UZS;

/** 450000 → "450 000" (oddiy bo'shliq: nusxalash va qidirish oson). */
export function formatGrouped(n: number): string {
  if (!Number.isSafeInteger(n)) throw new RangeError('Butun son kutilgan');
  const digits = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return n < 0 ? `-${digits}` : digits;
}

const CURRENCY_WORD: Record<Locale, string> = { 'uz-Latn': 'so‘m', 'uz-Cyrl': 'сўм' };

/** 450000 → "450 000 so‘m" / "450 000 сўм". */
export const formatUzs = (n: number, locale: Locale = 'uz-Latn'): string =>
  `${formatGrouped(n)} ${CURRENCY_WORD[locale]}`;

/** Tarix uchun ishorali ko'rinish: +450 000 / -200 000. */
export const formatSigned = (delta: number): string =>
  delta > 0 ? `+${formatGrouped(delta)}` : formatGrouped(delta);
