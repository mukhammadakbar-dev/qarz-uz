import type { Locale } from '../modules/identity/users.js';
import { uzCyrl } from './uz-cyrl.js';
import { uzLatn, type MessageKey } from './uz-latn.js';

export type { MessageKey };

const catalogs: Record<Locale, Record<MessageKey, string>> = {
  'uz-Latn': uzLatn,
  'uz-Cyrl': uzCyrl,
};

export type Params = Readonly<Record<string, string | number>>;

/** `{nom}` joylarini to'ldiradi. Berilmagan parametr bo'lsa xato (jim noto'g'ri matn chiqmasin). */
export function t(locale: Locale, key: MessageKey, params: Params = {}): string {
  return catalogs[locale][key].replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`i18n: "${key}" uchun {${name}} berilmagan`);
    return String(value);
  });
}

export const isLocale = (value: string): value is Locale => value in catalogs;
export const LOCALES = Object.keys(catalogs) as Locale[];

/** Taqqoslash uchun: matndagi barcha {parametr} nomlari. */
export const placeholdersOf = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).toSorted();

export { catalogs };
