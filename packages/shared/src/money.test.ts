import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  formatGrouped,
  formatSigned,
  formatUzs,
  isLargeAmount,
  isValidAmount,
  LARGE_AMOUNT_UZS,
  MAX_AMOUNT_UZS,
} from './money.js';

describe('isValidAmount', () => {
  it('chegaralar: 1 .. 10 mlrd, faqat butun son', () => {
    expect(isValidAmount(1)).toBe(true);
    expect(isValidAmount(MAX_AMOUNT_UZS)).toBe(true);
    for (const bad of [0, -1, MAX_AMOUNT_UZS + 1, 1.5, NaN, Infinity, -Infinity, 2 ** 60]) {
      expect(isValidAmount(bad), String(bad)).toBe(false);
    }
  });

  it('katta summa chegarasi 50 mln (inklyuziv)', () => {
    expect(isLargeAmount(LARGE_AMOUNT_UZS - 1)).toBe(false);
    expect(isLargeAmount(LARGE_AMOUNT_UZS)).toBe(true);
  });
});

describe('format', () => {
  it('TT misollari', () => {
    expect(formatUzs(450000)).toBe('450 000 so‘m');
    expect(formatUzs(225000, 'uz-Cyrl')).toBe('225 000 сўм');
    expect(formatGrouped(0)).toBe('0');
    expect(formatGrouped(999)).toBe('999');
    expect(formatGrouped(1000)).toBe('1 000');
    expect(formatGrouped(10_000_000_000)).toBe('10 000 000 000');
    expect(formatSigned(450000)).toBe('+450 000');
    expect(formatSigned(-200000)).toBe('-200 000');
  });

  it('kasr yoki xavfsiz bo‘lmagan sonni rad etadi', () => {
    expect(() => formatGrouped(1.5)).toThrow(RangeError);
    expect(() => formatGrouped(2 ** 60)).toThrow(RangeError);
  });

  it('property: raqamlar guruhlangandan keyin bo‘shliqlarni olib tashlasak asl son qaytadi', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX_AMOUNT_UZS }), (n) => {
        const text = formatGrouped(n);
        expect(Number(text.replaceAll(' ', ''))).toBe(n);
        expect(text).toMatch(/^\d{1,3}( \d{3})*$/);
      }),
    );
  });
});
