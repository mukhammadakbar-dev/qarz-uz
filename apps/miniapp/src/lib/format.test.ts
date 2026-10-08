import { describe, expect, it } from 'vitest';
import { ago, dayLabel, daysAgo, initials, signed, timeOf } from './format';
import { translate } from './i18n';

const latn = (k: Parameters<typeof translate>[1], p?: Record<string, number>) =>
  translate('uz-Latn', k, p);
// Toshkent: UTC+5. 2026-10-08 10:00 mahalliy vaqt
const NOW = new Date('2026-10-08T05:00:00Z');

describe('format', () => {
  it('daysAgo kalendar kun bo‘yicha (Toshkent vaqti), soat bo‘yicha emas', () => {
    expect(daysAgo('2026-10-08T00:30:00Z', NOW)).toBe(0);
    // UTC bo'yicha 7-oktabr 19:30, Toshkentda esa 8-oktabr 00:30 — bugun
    expect(daysAgo('2026-10-07T19:30:00Z', NOW)).toBe(0);
    expect(daysAgo('2026-10-07T18:59:00Z', NOW)).toBe(1);
    expect(daysAgo('2026-09-17T12:00:00Z', NOW)).toBe(21);
    expect(daysAgo('2026-10-09T12:00:00Z', NOW)).toBe(0); // kelajak — 0
  });

  it('ago: bugun, kecha, kun, hafta, oy', () => {
    expect([0, 1, 3, 14, 75].map((d) => ago(d, latn))).toEqual([
      'bugun',
      'kecha',
      '3 kun oldin',
      '2 hafta oldin',
      '2 oy oldin',
    ]);
  });

  it('dayLabel: Bugun, Kecha, sana; boshqa yil bo‘lsa yil bilan; Kirill oylar', () => {
    const t = (k: 'day.today' | 'day.yesterday') => translate('uz-Latn', k);
    expect(dayLabel('2026-10-08T03:00:00Z', 'uz-Latn', t, NOW)).toBe('Bugun');
    expect(dayLabel('2026-10-07T03:00:00Z', 'uz-Latn', t, NOW)).toBe('Kecha');
    expect(dayLabel('2026-10-03T03:00:00Z', 'uz-Latn', t, NOW)).toBe('3-oktabr');
    expect(dayLabel('2025-12-31T03:00:00Z', 'uz-Latn', t, NOW)).toBe('31-dekabr 2025');
    expect(dayLabel('2026-01-05T03:00:00Z', 'uz-Cyrl', t, NOW)).toBe('5-январ');
  });

  it('timeOf Toshkent vaqtida, 24 soatlik', () => {
    expect(timeOf('2026-10-08T09:32:00Z')).toBe('14:32');
  });

  it('initials va signed', () => {
    expect(initials('Olga Petrovna')).toBe('OP');
    expect(initials('murod')).toBe('MU');
    expect(initials('  Мурод  ака ')).toBe('МА');
    expect(signed(450000)).toBe('+450 000');
    expect(signed(-200000)).toBe('−200 000');
    expect(signed(0)).toBe('0');
  });
});
