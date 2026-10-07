import type { Pool } from 'pg';
import { withTenant } from '../../db/tenant.js';
import { subscriptionStatus, type SubscriptionStatus } from './status.js';

export interface BillingInfo {
  readonly status: SubscriptionStatus;
  readonly trialEndsAt: Date | null;
  readonly paidUntil: Date | null;
}

/** Obuna holati (barcha a'zolar ko'radi; narx va to'lov kontakti faqat egasiga). Obunasiz biznes — EXPIRED. */
export async function loadBilling(
  pool: Pool,
  access: { businessId: string; userId: string },
): Promise<BillingInfo> {
  const { rows } = await withTenant(
    pool,
    { businessId: access.businessId, userId: access.userId },
    (c) =>
      c.query<{ trial_ends_at: Date; paid_until: Date | null }>(
        'SELECT trial_ends_at, paid_until FROM subscriptions WHERE business_id = $1',
        [access.businessId],
      ),
  );
  const row = rows[0];
  if (!row) {
    return {
      status: subscriptionStatus({ trialEndsAt: new Date(0), paidUntil: null }),
      trialEndsAt: null,
      paidUntil: null,
    };
  }
  return {
    status: subscriptionStatus({ trialEndsAt: row.trial_ends_at, paidUntil: row.paid_until }),
    trialEndsAt: row.trial_ends_at,
    paidUntil: row.paid_until,
  };
}
