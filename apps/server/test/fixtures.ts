import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { withTenant } from '../src/db/tenant.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // I, O, 0, 1 siz

/** Tasodifiy TD-XXXXX qisqa kod (fayllar orasida to'qnashmasligi uchun). */
export function shortCode(): string {
  let code = '';
  for (const byte of randomBytes(5)) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return `TD-${code}`;
}

export async function createUser(pool: Pool, name = 'user'): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO users (telegram_user_id, first_name) VALUES ($1, $2) RETURNING id',
    [Math.floor(Math.random() * 1e12), name],
  );
  return rows[0]!.id;
}

/** Onboarding oqimi: yangi biznes + OWNER + obuna bitta tranzaksiyada. */
export async function createBusiness(
  pool: Pool,
  ownerId: string,
  name = 'Do‘kon',
): Promise<string> {
  const businessId = randomUUID();
  await withTenant(pool, { businessId, userId: ownerId }, async (c) => {
    await c.query(
      'INSERT INTO businesses (id, name, short_code, owner_user_id) VALUES ($1, $2, $3, $4)',
      [businessId, name, shortCode(), ownerId],
    );
    await c.query(
      "INSERT INTO business_members (business_id, user_id, role) VALUES ($1, $2, 'OWNER')",
      [businessId, ownerId],
    );
    await c.query(
      "INSERT INTO subscriptions (business_id, trial_ends_at) VALUES ($1, now() + interval '14 days')",
      [businessId],
    );
  });
  return businessId;
}

export async function addMember(
  pool: Pool,
  businessId: string,
  ownerId: string,
  userId: string,
  role: 'OWNER' | 'STAFF' = 'STAFF',
): Promise<void> {
  await withTenant(pool, { businessId, userId: ownerId }, (c) =>
    c.query('INSERT INTO business_members (business_id, user_id, role) VALUES ($1, $2, $3)', [
      businessId,
      userId,
      role,
    ]),
  );
}

export async function revokeMember(
  pool: Pool,
  businessId: string,
  ownerId: string,
  userId: string,
): Promise<void> {
  await withTenant(pool, { businessId, userId: ownerId }, (c) =>
    c.query(
      "UPDATE business_members SET status = 'REVOKED', revoked_at = now() WHERE business_id = $1 AND user_id = $2",
      [businessId, userId],
    ),
  );
}

/** Xom SQL bilan mijoz (servis qatlamisiz) — DB darajasidagi testlar uchun. */
export async function insertCustomer(
  pool: Pool,
  businessId: string,
  userId: string,
  name = `Mijoz-${randomUUID().slice(0, 8)}`,
  label: string | null = null,
): Promise<string> {
  const { rows } = await withTenant(pool, { businessId, userId }, (c) =>
    c.query<{ id: string }>(
      `INSERT INTO customers (business_id, name, normalized_name, label, normalized_label, created_by)
       VALUES ($1, $2, lower($2), $3, lower($3), $4) RETURNING id`,
      [businessId, name, label, userId],
    ),
  );
  return rows[0]!.id;
}

/** Xom SQL bilan qarz (LedgerService yozilgunga qadar va servisdan mustaqil tayyorgarlik uchun). */
export async function insertDebt(
  pool: Pool,
  businessId: string,
  userId: string,
  customerId: string,
  amount: number,
): Promise<void> {
  await withTenant(pool, { businessId, userId }, (c) =>
    c.query(
      `INSERT INTO ledger_entries (business_id, customer_id, type, amount, created_by, source, idempotency_key)
       VALUES ($1, $2, 'DEBT', $3, $4, 'SYSTEM', $5)`,
      [businessId, customerId, amount, userId, `fx-${randomUUID()}`],
    ),
  );
}
