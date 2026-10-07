import { describe, expect, it } from 'vitest';
import { isWritable, subscriptionStatus } from './status.js';

const d = (s: string) => new Date(s);
const NOW = d('2026-10-10T12:00:00Z');

describe('subscriptionStatus', () => {
  it('sinov muddati ichida TRIAL, kunlar yuqoriga yaxlitlanadi', () => {
    const s = subscriptionStatus({ trialEndsAt: d('2026-10-24T12:00:00Z'), paidUntil: null }, NOW);
    expect(s).toMatchObject({ state: 'TRIAL', daysLeft: 14 });
    const almost = subscriptionStatus(
      { trialEndsAt: d('2026-10-10T12:00:01Z'), paidUntil: null },
      NOW,
    );
    expect(almost).toMatchObject({ state: 'TRIAL', daysLeft: 1 });
  });

  it('sinov muddati tugagan va to‘lov yo‘q: EXPIRED', () => {
    const s = subscriptionStatus({ trialEndsAt: d('2026-10-10T12:00:00Z'), paidUntil: null }, NOW);
    expect(s).toMatchObject({ state: 'EXPIRED', daysLeft: 0 });
    expect(isWritable(s)).toBe(false);
  });

  it('to‘langan muddat sinovdan ustun: ACTIVE', () => {
    const s = subscriptionStatus(
      { trialEndsAt: d('2026-10-20T00:00:00Z'), paidUntil: d('2026-11-10T12:00:00Z') },
      NOW,
    );
    expect(s).toMatchObject({ state: 'ACTIVE', daysLeft: 31 });
    expect(isWritable(s)).toBe(true);
  });

  it('to‘lov muddati tugagan: EXPIRED, until oxirgi tugagan sana', () => {
    const s = subscriptionStatus(
      { trialEndsAt: d('2026-09-01T00:00:00Z'), paidUntil: d('2026-10-01T00:00:00Z') },
      NOW,
    );
    expect(s.state).toBe('EXPIRED');
    expect(s.until).toEqual(d('2026-10-01T00:00:00Z'));
  });

  it('chegara: paid_until aynan hozir bo‘lsa EXPIRED', () => {
    const s = subscriptionStatus({ trialEndsAt: d('2026-01-01T00:00:00Z'), paidUntil: NOW }, NOW);
    expect(s.state).toBe('EXPIRED');
  });

  it('TRIAL ham yozishga ruxsat beradi', () => {
    const s = subscriptionStatus({ trialEndsAt: d('2026-10-24T12:00:00Z'), paidUntil: null }, NOW);
    expect(isWritable(s)).toBe(true);
  });
});
