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

import type { Pool } from 'pg';
import { withTenant } from '../../db/tenant.js';

/** Biznes hozir yozishga ruxsat beradimi (xabar/menyu ko'rsatish uchun; yakuniy tekshiruv servislarda). */
export async function isBusinessWritable(
  pool: Pool,
  access: { businessId: string; userId: string },
): Promise<boolean> {
  try {
    await withTenant(pool, { businessId: access.businessId, userId: access.userId }, (c) =>
      assertWritable(c, access.businessId),
    );
    return true;
  } catch (error) {
    if (error instanceof SubscriptionExpiredError) return false;
    throw error;
  }
}
