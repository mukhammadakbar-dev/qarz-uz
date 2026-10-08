import { formatGrouped, formatUzs } from '@nasiya/shared';
import type { MessageKey } from './messages.latn';
import type { Locale } from './types';

export const money = (n: number, locale: Locale): string => formatUzs(n, locale);

/** Valyutasiz, mingliklar bo'shliq bilan: 450 000. */
export const grouped = (n: number): string => formatGrouped(n);

/** +450 000 / −200 000 (belgi bilan, valyutasiz). */
export const signed = (n: number): string =>
  n > 0 ? `+${formatGrouped(n)}` : n < 0 ? `−${formatGrouped(-n)}` : '0';

const TZ = 'Asia/Tashkent';

export const fullDate = (iso: string): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
    .format(new Date(iso))
    .replaceAll('/', '.');

/** 14:32 (Toshkent vaqti). */
export const timeOf = (iso: string): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));

/** Toshkent bo'yicha kalendar kuni: 2026-10-08. */
const dayKey = (date: Date): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

/** Necha kalendar kun oldin (Toshkent vaqti bo'yicha; bugun = 0). */
export function daysAgo(iso: string, now: Date = new Date()): number {
  const diff = Date.parse(dayKey(now)) - Date.parse(dayKey(new Date(iso)));
  return Math.max(0, Math.round(diff / 86_400_000));
}

/** "bugun", "kecha", "3 kun oldin", "2 hafta oldin", "4 oy oldin". */
export function ago(
  days: number,
  t: (key: MessageKey, p?: Record<string, number>) => string,
): string {
  if (days === 0) return t('ago.today');
  if (days === 1) return t('ago.yesterday');
  if (days < 7) return t('ago.days', { n: days });
  if (days < 30) return t('ago.weeks', { n: Math.floor(days / 7) });
  return t('ago.months', { n: Math.floor(days / 30) });
}

const MONTHS: Record<Locale, readonly string[]> = {
  'uz-Latn': [
    'yanvar',
    'fevral',
    'mart',
    'aprel',
    'may',
    'iyun',
    'iyul',
    'avgust',
    'sentabr',
    'oktabr',
    'noyabr',
    'dekabr',
  ],
  'uz-Cyrl': [
    'январ',
    'феврал',
    'март',
    'апрел',
    'май',
    'июн',
    'июл',
    'август',
    'сентабр',
    'октабр',
    'ноябр',
    'декабр',
  ],
};

/** Tarix guruhi sarlavhasi: "Bugun", "Kecha", "3-oktabr", boshqa yil bo'lsa "3-oktabr 2025". */
export function dayLabel(
  iso: string,
  locale: Locale,
  t: (key: 'day.today' | 'day.yesterday') => string,
  now: Date = new Date(),
): string {
  const days = daysAgo(iso, now);
  if (days === 0) return t('day.today');
  if (days === 1) return t('day.yesterday');
  const [year, month, day] = dayKey(new Date(iso)).split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const label = `${day}-${MONTHS[locale][month - 1]}`;
  return year === Number(dayKey(now).slice(0, 4)) ? label : `${label} ${year}`;
}

/** Ismdan bosh harflar: "Olga Petrovna" → "OP", "Murod" → "MU". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  return (words[0] ?? '?').slice(0, 2).toUpperCase();
}

/** Faqat raqamlar → son (bo'sh = 0). Juda uzun kiritma kesiladi (10 mlrd = 11 xona). */
export const parseDigits = (text: string): number =>
  Number(text.replace(/\D/g, '').slice(0, 11) || '0');
