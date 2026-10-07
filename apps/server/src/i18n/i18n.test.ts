import { describe, expect, it } from 'vitest';
import { catalogs, LOCALES, placeholdersOf, t, type MessageKey } from './index.js';

const keys = Object.keys(catalogs['uz-Latn']) as MessageKey[];

describe('i18n katalog', () => {
  it('ikkala katalog bir xil kalitlarga ega', () => {
    expect(Object.keys(catalogs['uz-Cyrl']).toSorted()).toEqual(keys.toSorted());
  });

  it('har bir kalit uchun {parametr} nomlari ikkala tilda bir xil', () => {
    for (const key of keys) {
      expect(placeholdersOf(catalogs['uz-Cyrl'][key]), key).toEqual(
        placeholdersOf(catalogs['uz-Latn'][key]),
      );
    }
  });

  it('Kirill katalogida (til tugmalari va texnik nomlardan tashqari) Lotin matni qolmagan', () => {
    const allowed = new Set<MessageKey>(['lang.button.latn']);
    for (const key of keys) {
      if (allowed.has(key)) continue;
      const stripped = catalogs['uz-Cyrl'][key]
        .replace(/\{\w+\}/g, '')
        .replace(/\/\w+/g, '') // /start kabi buyruqlar
        .replace(/Mini App/g, '')
        .replace(/Tilni tanlang/g, ''); // welcome.new ikki tilli
      expect(/[A-Za-z]/.test(stripped), `${key}: ${stripped}`).toBe(false);
    }
  });

  it('Lotin katalogida Kirill belgilari faqat til tugmasi va ikki tilli salomda', () => {
    const allowed = new Set<MessageKey>(['lang.button.cyrl', 'welcome.new', 'lang.pick']);
    for (const key of keys) {
      if (allowed.has(key)) continue;
      expect(/[А-Яа-яЁёЎўҚқҒғҲҳ]/.test(catalogs['uz-Latn'][key]), key).toBe(false);
    }
  });

  it('t() parametrlarni to‘ldiradi va yetishmasa xato beradi', () => {
    expect(t('uz-Latn', 'start.switched', { name: 'Baraka' })).toBe('«Baraka» tanlandi.');
    expect(t('uz-Cyrl', 'start.switched', { name: 'Барака' })).toBe('«Барака» танланди.');
    expect(() => t('uz-Latn', 'start.switched')).toThrow(/name/);
  });

  it('LOCALES ikkala tilni o‘z ichiga oladi', () => {
    expect(LOCALES.toSorted()).toEqual(['uz-Cyrl', 'uz-Latn']);
  });
});
