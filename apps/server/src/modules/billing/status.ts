/**
 * Obuna holati (ADR-0005): saqlanmaydi, sanalardan hisoblanadi.
 *   now < paid_until      → ACTIVE
 *   now < trial_ends_at   → TRIAL
 *   aks holda             → EXPIRED (faqat ko'rish)
 */
export type SubscriptionState = 'TRIAL' | 'ACTIVE' | 'EXPIRED';

export interface Subscription {
  readonly trialEndsAt: Date;
  readonly paidUntil: Date | null;
}

export interface SubscriptionStatus {
  readonly state: SubscriptionState;
  /** Joriy holat tugaydigan sana (EXPIRED bo'lsa oxirgi tugagan sana). */
  readonly until: Date;
  /** Qolgan to'liq/qisman kunlar (yuqoriga yaxlitlanadi); EXPIRED da 0. */
  readonly daysLeft: number;
}

const DAY_MS = 86_400_000;

export function subscriptionStatus(sub: Subscription, now: Date = new Date()): SubscriptionStatus {
  const t = now.getTime();
  if (sub.paidUntil && t < sub.paidUntil.getTime()) {
    return {
      state: 'ACTIVE',
      until: sub.paidUntil,
      daysLeft: Math.ceil((sub.paidUntil.getTime() - t) / DAY_MS),
    };
  }
  if (t < sub.trialEndsAt.getTime()) {
    return {
      state: 'TRIAL',
      until: sub.trialEndsAt,
      daysLeft: Math.ceil((sub.trialEndsAt.getTime() - t) / DAY_MS),
    };
  }
  const last = sub.paidUntil && sub.paidUntil > sub.trialEndsAt ? sub.paidUntil : sub.trialEndsAt;
  return { state: 'EXPIRED', until: last, daysLeft: 0 };
}

/** Yozuvlarga (qarz, to'lov, o'chirish) ruxsat beradimi? */
export const isWritable = (status: SubscriptionStatus): boolean => status.state !== 'EXPIRED';
