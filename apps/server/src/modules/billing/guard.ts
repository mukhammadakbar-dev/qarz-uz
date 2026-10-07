import type { PoolClient } from 'pg';
import { SubscriptionExpiredError } from '../../errors/index.js';
import { isWritable, subscriptionStatus } from './status.js';

/**
 * Obuna tekshiruvi servis ichida, tranzaksiyada bajariladi (ADR-0005): UI'ga ishonilmaydi.
 * EXPIRED bo'lsa yozuvlar (mijoz, qarz, to'lov, o'chirish) bloklanadi, o'qish ishlaydi.
 * Obunasi yo'q biznes ham yozolmaydi (fail-closed).
 */
export async function assertWritable(client: PoolClient, businessId: string): Promise<void> {
  const { rows } = await client.query<{ trial_ends_at: Date; paid_until: Date | null }>(
    'SELECT trial_ends_at, paid_until FROM subscriptions WHERE business_id = $1',
    [businessId],
  );
  const row = rows[0];
  if (!row) throw new SubscriptionExpiredError();
  const status = subscriptionStatus({ trialEndsAt: row.trial_ends_at, paidUntil: row.paid_until });
  if (!isWritable(status)) {
    throw new SubscriptionExpiredError({ details: { until: status.until.toISOString() } });
  }
}
