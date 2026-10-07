import { describe, expect, it } from 'vitest';
import { decide, type PolicyInput } from './policy.js';
import type { CustomerRef } from './resolver.js';

const customer = (balance: number): CustomerRef => ({
  id: 'c1',
  name: 'Murod',
  normalizedName: 'murod',
  label: null,
  normalizedLabel: null,
  balance,
});
const payment = (
  over: Partial<PolicyInput['intent']>,
  balance: number,
  writable = true,
): PolicyInput => ({
  intent: {
    intent: 'CREATE_PAYMENT',
    customer: 'murod',
    amount: null,
    amountKind: 'NONE',
    fraction: null,
    dateOffsetDays: 0,
    ...over,
  },
  resolution: { kind: 'resolved', customer: customer(balance) },
  writable,
});
const debt = (over: Partial<PolicyInput['intent']>, balance = 0): PolicyInput => ({
  intent: {
    intent: 'CREATE_DEBT',
    customer: 'murod',
    amount: null,
    amountKind: 'NONE',
    fraction: null,
    dateOffsetDays: 0,
    ...over,
  },
  resolution: { kind: 'resolved', customer: customer(balance) },
  writable: true,
});

describe('decide: to‘lov (Q1: ortiqcha to‘lov hech qachon)', () => {
  const abs = (amount: number, balance: number) =>
    decide(payment({ amount, amountKind: 'ABSOLUTE' }, balance));

  it('chegara: qoldiqqa teng — mumkin, 1 so‘m ortiq — rad', () => {
    expect(abs(100000, 100000)).toMatchObject({ action: 'CONFIRM', balanceAfter: 0 });
    expect(abs(100001, 100000)).toMatchObject({ action: 'REJECT_OVERPAY', maxPayable: 100000 });
    expect(abs(100001, 100000).draft).toBeUndefined();
  });

  it('qarzi yo‘q: REJECT_NO_DEBT', () => {
    expect(abs(1, 0)).toMatchObject({ action: 'REJECT_NO_DEBT', maxPayable: 0 });
  });

  it('FULL: summa qoldiqdan; tasdiqsiz yozilmaydi (faqat draft)', () => {
    const d = decide(payment({ amountKind: 'FULL' }, 450000));
    expect(d).toMatchObject({ action: 'CONFIRM_FULL', amount: 450000, balanceAfter: 0 });
    expect(d.draft).toMatchObject({
      type: 'PAYMENT',
      amount: 450000,
      kind: 'FULL',
      expectedBalance: 450000,
    });
  });

  it('FRACTION pastga yaxlitlanadi, 0 chiqsa rad etiladi', () => {
    const half = (balance: number) =>
      decide(payment({ amountKind: 'FRACTION', fraction: [1, 2] }, balance));
    expect(half(100001)).toMatchObject({
      action: 'CONFIRM_FRACTION',
      amount: 50000,
      balanceAfter: 50001,
    });
    expect(half(1)).toMatchObject({ action: 'REJECT_INVALID_AMOUNT' });
    expect(decide(payment({ amountKind: 'FRACTION', fraction: [1, 3] }, 100000))).toMatchObject({
      amount: 33333,
      balanceAfter: 66667,
    });
  });

  it('summa yo‘q → ASK_AMOUNT; noto‘g‘ri summalar → REJECT_INVALID_AMOUNT', () => {
    expect(decide(payment({}, 5000)).action).toBe('ASK_AMOUNT');
    for (const bad of [0, -1, 1.5, 10_000_000_001, Number.NaN]) {
      expect(abs(bad, 5000).action, String(bad)).toBe('REJECT_INVALID_AMOUNT');
    }
  });

  it('obuna tugagan: BLOCKED_SUBSCRIPTION, draft yo‘q', () => {
    const d = decide(payment({ amount: 100, amountKind: 'ABSOLUTE' }, 5000, false));
    expect(d.action).toBe('BLOCKED_SUBSCRIPTION');
    expect(d.draft).toBeUndefined();
  });
});

describe('decide: nasiya', () => {
  it('oddiy, katta (≥ 50 mln) va chegaradan oshgan summalar', () => {
    expect(decide(debt({ amount: 49_999_999, amountKind: 'ABSOLUTE' })).action).toBe('CONFIRM');
    expect(decide(debt({ amount: 50_000_000, amountKind: 'ABSOLUTE' })).action).toBe(
      'WARN_LARGE_AMOUNT',
    );
    expect(decide(debt({ amount: 10_000_000_000, amountKind: 'ABSOLUTE' })).action).toBe(
      'WARN_LARGE_AMOUNT',
    );
    expect(decide(debt({ amount: 10_000_000_001, amountKind: 'ABSOLUTE' })).action).toBe(
      'REJECT_INVALID_AMOUNT',
    );
  });

  it('draft sana siljishi va kutilgan qoldiqni saqlaydi', () => {
    const d = decide(debt({ amount: 1000, amountKind: 'ABSOLUTE', dateOffsetDays: -1 }, 5000));
    expect(d.draft).toEqual({
      type: 'DEBT',
      customerId: 'c1',
      newCustomerName: null,
      amount: 1000,
      dateOffsetDays: -1,
      expectedBalance: 5000,
      kind: 'ABSOLUTE',
    });
  });

  it('yangi mijoz: faqat nasiya uchun va tasdiq bilan; to‘lov uchun rad', () => {
    const none = { resolution: { kind: 'none' } as const, writable: true };
    const newDebt = decide({
      ...none,
      intent: {
        intent: 'CREATE_DEBT',
        customer: 'yangi',
        amount: 5000,
        amountKind: 'ABSOLUTE',
        fraction: null,
        dateOffsetDays: 0,
      },
    });
    expect(newDebt).toMatchObject({ action: 'CONFIRM_NEW_CUSTOMER', newCustomerName: 'yangi' });
    expect(newDebt.draft).toMatchObject({
      customerId: null,
      newCustomerName: 'yangi',
      expectedBalance: 0,
    });
    const newPay = decide({
      ...none,
      intent: {
        intent: 'CREATE_PAYMENT',
        customer: 'yangi',
        amount: 5000,
        amountKind: 'ABSOLUTE',
        fraction: null,
        dateOffsetDays: 0,
      },
    });
    expect(newPay.action).toBe('REJECT_UNKNOWN_CUSTOMER');
  });

  it('mijoz ko‘rsatilmagan → ASK_CUSTOMER, hech qachon draft yo‘q', () => {
    const d = decide({
      intent: {
        intent: 'CREATE_PAYMENT',
        customer: null,
        amount: 5000,
        amountKind: 'ABSOLUTE',
        fraction: null,
        dateOffsetDays: 0,
      },
      resolution: null,
      writable: true,
    });
    expect(d).toMatchObject({ action: 'ASK_CUSTOMER' });
    expect(d.draft).toBeUndefined();
  });
});

describe('decide: boshqa', () => {
  it('ko‘rish buyruqlari obuna tugaganda ham ishlaydi', () => {
    const view = (intent: 'VIEW_CUSTOMER_BALANCE' | 'VIEW_CUSTOMER_HISTORY') =>
      decide({
        intent: {
          intent,
          customer: 'murod',
          amount: null,
          amountKind: 'NONE',
          fraction: null,
          dateOffsetDays: 0,
        },
        resolution: { kind: 'resolved', customer: customer(700) },
        writable: false,
      });
    expect(view('VIEW_CUSTOMER_BALANCE')).toMatchObject({
      action: 'SHOW_BALANCE',
      balanceBefore: 700,
    });
    expect(view('VIEW_CUSTOMER_HISTORY').action).toBe('SHOW_HISTORY');
  });
});
