import { describe, expect, it } from 'vitest';
import { redactPii } from './redact.js';

describe('redactPii', () => {
  it('telefon raqamlari', () => {
    for (const t of [
      '+998901234567',
      '+998 90 123 45 67',
      '998901234567',
      '90 123 45 67',
      '(+998) 90 123-45-67',
    ]) {
      expect(redactPii(`Akmal ${t} yoz`), t).toBe('Akmal <PHONE> yoz');
    }
    expect(redactPii('qo‘ng‘iroq +7 900 123 45 67')).toBe('qo‘ng‘iroq <PHONE>');
  });

  it('karta raqami (Luhn) — guruhli ham, yaxlit ham', () => {
    expect(redactPii('karta 4111 1111 1111 1111 ok')).toBe('karta <CARD> ok');
    expect(redactPii('karta 4111111111111111')).toBe('karta <CARD>');
    expect(redactPii('8600-1234-5678-9013')).toContain('8600'); // Luhn emas → karta deb olinmaydi
  });

  it('SUMMALAR buzilmaydi', () => {
    for (const amount of [
      '900 000',
      '1 200 000',
      '50 000',
      '50000',
      '50.000',
      '450,000',
      '1.200.000',
      '900000000',
      '10000000000',
      '49 999 999',
      '50 ming',
      '1,5 mln',
      '2 mln 500 ming',
      '100 001',
    ]) {
      expect(redactPii(`Murod ${amount} berdi`), amount).toBe(`Murod ${amount} berdi`);
    }
  });

  it('prefiksiz oddiy 9 xonali son summa hisoblanadi (ADR-0004 §6)', () => {
    expect(redactPii('Murod 901234567')).toBe('Murod 901234567');
  });

  it('email va URL', () => {
    expect(redactPii('a.b+c@mail.uz yozdi')).toBe('<EMAIL> yozdi');
    expect(redactPii('qarang https://t.me/x?y=1 va www.site.uz')).toBe('qarang <URL> va <URL>');
  });

  it('ism va oddiy matn o‘zgarmaydi', () => {
    expect(redactPii('Мурод 50 минг берди')).toBe('Мурод 50 минг берди');
  });
});
