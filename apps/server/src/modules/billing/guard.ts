import type { PoolClient } from 'pg';
import { SubscriptionExpiredError } from '../../errors/index.js';
import { isWritable, subscriptionStatus } from './status.js';

/**
 * Obuna tekshiruvi servis ichida, tranzaksiyada bajariladi (ADR-0005): UI'ga ishonilmaydi.
 * EXPIRED bo'lsa yozuvlar (mijoz, qarz, to'lov, o'chirish) bloklanadi, o'qish ishlaydi.
 * Obunasi yo'q biznes ham yozolmaydi (fail-closed). Superadmin bloklagan do'kon ham (reason: SUSPENDED).
 */
export async function assertWritable(client: PoolClient, businessId: string): Promise<void> {
  const { rows } = await client.query<{
    trial_ends_at: Date;
    paid_until: Date | null;
    suspended: boolean;
  }>(
    `SELECT s.trial_ends_at, s.paid_until, b.suspended_at IS NOT NULL AS suspended
       FROM subscriptions s JOIN businesses b ON b.id = s.business_id
      WHERE s.business_id = $1`,
    [businessId],
  );
  const row = rows[0];
  if (!row) throw new SubscriptionExpiredError();
  // Superadmin bloklagan do'kon: obunasidan qat'i nazar faqat o'qiladi
  if (row.suspended) throw new SubscriptionExpiredError({ details: { reason: 'SUSPENDED' } });
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

/** Do'kon superadmin tomonidan bloklanganmi (xabar matnini tanlash uchun). */
export async function isBusinessSuspended(
  pool: Pool,
  access: { businessId: string; userId: string },
): Promise<boolean> {
  const { rows } = await withTenant(
    pool,
    { businessId: access.businessId, userId: access.userId },
    (c) =>
      c.query<{ suspended: boolean }>(
        'SELECT suspended_at IS NOT NULL AS suspended FROM businesses WHERE id = $1',
        [access.businessId],
      ),
  );
  return rows[0]?.suspended ?? false;
}
