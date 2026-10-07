import { describe, expect, it } from 'vitest';
import { parseRules, type RuleResult } from './rules.js';

const p = (t: string): RuleResult => parseRules(t);

describe('parseRules: golden dataset’da bo‘lmagan holatlar', () => {
  it('Olga kabi -ga bilan tugaydigan ism: yo‘nalish noaniq → UNKNOWN (xavfsiz), alt shakl saqlanadi', () => {
    const r = p('Olga 50 ming berdi');
    expect(r.intent).toBe('UNKNOWN');
    const debt = p('Olgaga 50 ming yoz');
    expect(debt).toMatchObject({ intent: 'CREATE_DEBT', customer: 'olga', amount: 50000 });
  });

  it('“Olga 50 ming yoz” (dativ emas, lekin -ga): customer kesiladi, customerAlt to‘liq', () => {
    const r = p('Olga 50 ming yoz');
    expect(r).toMatchObject({
      intent: 'CREATE_DEBT',
      customer: 'ol',
      customerAlt: 'olga',
      nameSuffix: 'dat',
    });
  });

  it('ko‘p so‘zli ism va ism+familiya', () => {
    expect(p('Ali Valiyev 50 ming berdi')).toMatchObject({
      intent: 'CREATE_PAYMENT',
      customer: 'ali valiyev',
    });
    expect(p('Murod aka 50 ming yoz')).toMatchObject({ customer: 'murod aka' });
  });

  it('noma’lum so‘z ismga qo‘shiladi (resolver bunday moslikni avtomatik tanlamaydi)', () => {
    expect(p('Murod 30 ming ber')).toMatchObject({ intent: 'CREATE_DEBT', customer: 'murod ber' });
  });

  it('to‘rt va undan ko‘p so‘zli “ism” rad etiladi (prompt-injection himoyasi)', () => {
    expect(p('Murod bu yerda juda uzun gap 50 ming').intent).toBe('UNKNOWN');
  });

  it('turli summalar → summa tanlanmaydi', () => {
    expect(p('Murod 5 ming 3 ming berdi')).toMatchObject({
      intent: 'CREATE_PAYMENT',
      amount: null,
      amountKind: 'NONE',
      multiAmount: true,
    });
  });

  it('manfiy va nol summa interpreter darajasida o‘tkaziladi (rad etish — policy ishi)', () => {
    expect(p('Murod -50 ming').amount).toBe(-50000);
    expect(p('Murod 0 yoz').amount).toBe(0);
  });

  it('fe’l bilan summa yo‘q: to‘lov, FULL va FRACTION faqat to‘lovda', () => {
    expect(p('Murod qarzini yoz')).toMatchObject({ intent: 'CREATE_DEBT', amountKind: 'NONE' }); // nasiyada FULL ma’nosiz
    expect(p('Murod qarzini berdi')).toMatchObject({
      intent: 'CREATE_PAYMENT',
      amountKind: 'FULL',
    });
  });

  it('mavjud summa FULL so‘zidan ustun', () => {
    expect(p('Murod 50 ming qarzini berdi')).toMatchObject({
      amount: 50000,
      amountKind: 'ABSOLUTE',
    });
  });

  it('savol va inkor: hech qachon operatsiya emas', () => {
    for (const t of [
      'Murod 50 ming berdimi',
      'Murod 50 ming berdi?',
      'Murod 50 ming to‘lamadi',
      'Murod 50 ming to‘laydi',
      'Murod ertaga 50 ming',
    ]) {
      expect(p(t).intent, t).toBe('UNKNOWN');
    }
  });

  it('telefon summa deb olinmaydi', () => {
    const r = p('Yangi mijoz Akmal +998 90 123 45 67');
    expect(r).toMatchObject({
      intent: 'CREATE_CUSTOMER',
      customer: 'akmal',
      phone: '+998901234567',
    });
    expect(r.amountCandidates).toEqual([]);
  });

  it('juda uzun kiritma, bo‘sh matn va belgilar', () => {
    expect(p('a'.repeat(1001)).reason).toBe('too_long');
    expect(p('   ').intent).toBe('UNKNOWN');
    expect(p('🙂🙂🙂').intent).toBe('UNKNOWN');
  });

  it('salomlashuv ism hisoblanmaydi', () => {
    expect(p('Salom').customer).toBeNull();
    expect(p('Assalomu alaykum').customer).toBeNull();
  });

  it('SQL va kod parchalari ta’sir qilmaydi', () => {
    for (const t of [
      "Murod'; DROP TABLE users;-- 50 ming",
      '<img src=x onerror=alert(1)>',
      '${process.exit(1)} 100 ming',
    ]) {
      const r = p(t);
      expect(
        r.intent === 'UNKNOWN' || r.customer === null || !/[;<>$(){}=]/.test(r.customer),
        t,
      ).toBe(true);
    }
  });
});
