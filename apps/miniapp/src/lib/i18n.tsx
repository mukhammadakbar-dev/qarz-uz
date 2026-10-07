import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { cyrl } from './messages.cyrl';
import { latn, type MessageKey } from './messages.latn';
import type { Locale } from './types';

export type { MessageKey };
export type Params = Readonly<Record<string, string | number>>;

export const catalogs: Record<Locale, Record<MessageKey, string>> = {
  'uz-Latn': latn,
  'uz-Cyrl': cyrl,
};

export function translate(locale: Locale, key: MessageKey, params: Params = {}): string {
  return catalogs[locale][key].replace(/\{(\w+)\}/g, (_m, name: string) => {
    const v = params[name];
    return v === undefined ? `{${name}}` : String(v);
  });
}

export const placeholdersOf = (s: string): string[] =>
  [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).toSorted();

interface I18n {
  locale: Locale;
  t: (key: MessageKey, params?: Params) => string;
}
const Context = createContext<I18n>({ locale: 'uz-Latn', t: (k, p) => translate('uz-Latn', k, p) });

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo<I18n>(() => ({ locale, t: (k, p) => translate(locale, k, p) }), [locale]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useI18n = (): I18n => useContext(Context);
