import { formatGrouped, formatUzs } from '@nasiya/shared';
import type { Locale } from './types';

export const money = (n: number, locale: Locale): string => formatUzs(n, locale);

/** +450 000 / −200 000 (belgi bilan, valyutasiz). */
export const signed = (n: number): string => (n > 0 ? `+${formatGrouped(n)}` : formatGrouped(n));

const TZ = 'Asia/Tashkent';
export const shortDate = (iso: string): string =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit' })
    .format(new Date(iso))
    .replace('/', '.');

export const fullDate = (iso: string): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
    .format(new Date(iso))
    .replaceAll('/', '.');

/** Faqat raqamlar → son (bo'sh = 0). Juda uzun kiritma kesiladi (10 mlrd = 11 xona). */
export const parseDigits = (text: string): number =>
  Number(text.replace(/\D/g, '').slice(0, 11) || '0');
