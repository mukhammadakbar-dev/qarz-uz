import { describe, expect, it } from 'vitest';
import { catalogs, placeholdersOf, translate, type MessageKey } from './i18n';

const keys = Object.keys(catalogs['uz-Latn']) as MessageKey[];

describe('Mini App i18n', () => {
  it('ikkala katalogda kalitlar va {parametr} lar bir xil', () => {
    expect(Object.keys(catalogs['uz-Cyrl']).toSorted()).toEqual(keys.toSorted());
    for (const k of keys)
      expect(placeholdersOf(catalogs['uz-Cyrl'][k]), k).toEqual(
        placeholdersOf(catalogs['uz-Latn'][k]),
      );
  });

  it('Kirill katalogida Lotin matni qolmagan (buyruq va nomlardan tashqari)', () => {
    for (const k of keys) {
      const text = catalogs['uz-Cyrl'][k].replace(/\{\w+\}/g, '').replace(/\/start/g, '');
      expect(/[A-Za-z]/.test(text), `${k}: ${text}`).toBe(false);
    }
  });

  it('Lotin katalogida Kirill belgilari yo‘q', () => {
    for (const k of keys) expect(/[А-Яа-яЎўҚқҒғҲҳ]/.test(catalogs['uz-Latn'][k]), k).toBe(false);
  });

  it('translate parametrlarni to‘ldiradi, yetishmaganini ko‘rinadigan qoldiradi', () => {
    expect(translate('uz-Latn', 'banner.trial', { days: 2 })).toBe('Sinov muddati: 2 kun qoldi');
    expect(translate('uz-Cyrl', 'banner.trial', { days: 2 })).toBe('Синов муддати: 2 кун қолди');
    expect(translate('uz-Latn', 'banner.trial')).toContain('{days}');
  });
});
