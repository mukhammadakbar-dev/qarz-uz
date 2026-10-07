import type { Pool, PoolClient } from 'pg';
import { withTransaction } from './pool.js';

/**
 * RLS konteksti (ADR-0006 §6). `businessId` va `userId` faqat server tomonida tekshirilgan
 * (membership bilan tasdiqlangan) qiymatlardan olinadi, klient yuborganiga ishonilmaydi.
 */
export interface TenantContext {
  readonly businessId?: string;
  readonly userId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Bitta tranzaksiya ichida `app.business_id` / `app.user_id` ni o'rnatadi (`set_config(..., true)` =
 * SET LOCAL, tranzaksiya tugaganda yo'qoladi, pool'dagi boshqa so'rovga sizib o'tmaydi).
 * Hech narsa berilmasa RLS jadvallarida qator ko'rinmaydi (fail-closed).
 */
export function withTenant<T>(
  pool: Pool,
  context: TenantContext,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  for (const [name, value] of Object.entries(context)) {
    if (value !== undefined && !UUID.test(value)) {
      throw new TypeError(`TenantContext.${name} UUID bo'lishi kerak`);
    }
  }
  return withTransaction(pool, async (client) => {
    await client.query(
      "SELECT set_config('app.business_id', $1, true), set_config('app.user_id', $2, true)",
      [context.businessId ?? '', context.userId ?? ''],
    );
    return fn(client);
  });
}
