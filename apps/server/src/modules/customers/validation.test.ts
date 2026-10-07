import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../errors/index.js';
import { parseCustomerLabel, parseCustomerName, parseNotes, parsePhone } from './validation.js';

describe('parseCustomerName', () => {
  it('ko‘rinish va normallashtirilgan shaklni qaytaradi', () => {
    expect(parseCustomerName('  Мурод   ака ')).toEqual({
      display: 'Мурод ака',
      normalized: 'murod aka',
    });
    expect(parseCustomerName('G‘ayrat')).toEqual({ display: 'G‘ayrat', normalized: "g'ayrat" });
  });

  it('bo‘sh, faqat belgilar yoki juda uzun nomni rad etadi', () => {
    for (const bad of ['', '   ', '!!!', '🙂🙂', 'x'.repeat(101)]) {
      expect(() => parseCustomerName(bad), bad).toThrow(ValidationError);
    }
    expect(parseCustomerName('x'.repeat(100)).display).toHaveLength(100);
  });

  it('ko‘rinmas va boshqaruv belgilarini tozalaydi', () => {
    expect(parseCustomerName('Mu​rod\u0000').display).toBe('Mu rod');
  });
});

describe('parseCustomerLabel', () => {
  it('50 belgigacha', () => {
    expect(parseCustomerLabel('qo‘shni').normalized).toBe("qo'shni");
    expect(() => parseCustomerLabel('x'.repeat(51))).toThrow(ValidationError);
  });
});

describe('parsePhone', () => {
  it('turli yozuvlar bitta formatga keladi', () => {
    for (const raw of [
      '+998901234567',
      '+998 90 123 45 67',
      '998901234567',
      '90 123 45 67',
      '901234567',
      '(90) 123-45-67',
    ]) {
      expect(parsePhone(raw), raw).toBe('+998901234567');
    }
  });

  it('noto‘g‘ri raqamlarni rad etadi', () => {
    for (const bad of [
      '',
      '12345',
      '+99890123456',
      '+9989012345678',
      '90123456a',
      '+7 900 123 45 67',
      'telefon',
    ]) {
      expect(() => parsePhone(bad), bad).toThrow(ValidationError);
    }
  });
});

describe('parseNotes', () => {
  it('qator uzilishini saqlaydi, uzunlikni cheklaydi', () => {
    expect(parseNotes('  birinchi\nikkinchi\u0000  ')).toBe('birinchi\nikkinchi');
    expect(() => parseNotes('x'.repeat(501))).toThrow(ValidationError);
  });
});
