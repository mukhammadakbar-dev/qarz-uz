import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { withTenant } from '../../db/tenant.js';
import { ConflictError, ValidationError } from '../../errors/index.js';
import { getContext } from '../../observability/context.js';

export const MAX_OWNED_BUSINESSES = 5;
const NAME_MAX = 100;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // I, O, 0, 1 siz (o'qishda chalkashmasin)
const CODE_LENGTH = 5;

/** Foydalanuvchi kiritgan biznes nomini tozalaydi va tekshiradi. */
export function normalizeBusinessName(raw: string): string {
  const name = raw
    .normalize('NFC')
    // boshqaruv belgilari va ko'rinmas formatlash belgilari
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (name.length < 1 || name.length > NAME_MAX || name.startsWith('/')) {
    throw new ValidationError('Biznes nomi yaroqsiz', { details: { field: 'name' } });
  }
  return name;
}

export function generateShortCode(): string {
  let code = '';
  for (const byte of randomBytes(CODE_LENGTH)) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return `TD-${code}`;
}

export interface CreatedBusiness {
  readonly businessId: string;
  readonly name: string;
  readonly shortCode: string;
  /** Bepul sinov berildimi (har foydalanuvchiga bir marta, ADR-0005). */
  readonly trialGranted: boolean;
  readonly trialEndsAt: Date;
}

export interface CreateBusinessOptions {
  readonly trialDays: number;
  readonly maxOwned?: number;
}

/**
 * Onboarding: biznes + OWNER + obuna + aktiv biznes bitta tranzaksiyada (TT §27).
 * Bepul sinov `users.trial_used_at IS NULL` shartli UPDATE bilan atomik beriladi: parallel
 * ikkita so'rov ham ikkita sinov ola olmaydi.
 */
export async function createBusinessWithOwner(
  pool: Pool,
  userId: string,
  rawName: string,
  options: CreateBusinessOptions,
): Promise<CreatedBusiness> {
  const name = normalizeBusinessName(rawName);
  const businessId = randomUUID();
  const maxOwned = options.maxOwned ?? MAX_OWNED_BUSINESSES;

  return withTenant(pool, { businessId, userId }, async (c) => {
    const owned = await c.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM business_members WHERE user_id = $1 AND role = 'OWNER' AND status = 'ACTIVE'",
      [userId],
    );
    if ((owned.rows[0]?.n ?? 0) >= maxOwned) {
      throw new ConflictError('Biznes limiti oshdi', { details: { max: maxOwned } });
    }

    const trial = await c.query(
      'UPDATE users SET trial_used_at = now() WHERE id = $1 AND trial_used_at IS NULL',
      [userId],
    );
    const trialGranted = trial.rowCount === 1;

    let shortCode = '';
    for (let attempt = 0; attempt < 10 && !shortCode; attempt++) {
      const code = generateShortCode();
      const res = await c.query(
        'INSERT INTO businesses (id, name, short_code, owner_user_id) VALUES ($1, $2, $3, $4) ON CONFLICT (short_code) DO NOTHING',
        [businessId, name, code, userId],
      );
      if (res.rowCount === 1) shortCode = code;
    }
    if (!shortCode) throw new Error('Noyob qisqa kod topilmadi');

    await c.query(
      "INSERT INTO business_members (business_id, user_id, role) VALUES ($1, $2, 'OWNER')",
      [businessId, userId],
    );
    // Sinov berilmagan bo'lsa trial_ends_at = hozir: obuna darhol EXPIRED (ADR-0005)
    const sub = await c.query<{ trial_ends_at: Date }>(
      `INSERT INTO subscriptions (business_id, trial_ends_at)
       VALUES ($1, CASE WHEN $2::boolean THEN now() + make_interval(days => $3) ELSE now() END)
       RETURNING trial_ends_at`,
      [businessId, trialGranted, options.trialDays],
    );
    await c.query('UPDATE users SET active_business_id = $2 WHERE id = $1', [userId, businessId]);
    await c.query(
      `INSERT INTO audit_logs (business_id, actor_user_id, action, entity, entity_id, after, request_id)
       VALUES ($1, $2, 'business.create', 'business', $1::uuid::text, $3::jsonb, $4)`,
      [
        businessId,
        userId,
        JSON.stringify({ name, shortCode, trialGranted }),
        getContext()?.requestId ?? null,
      ],
    );

    return { businessId, name, shortCode, trialGranted, trialEndsAt: sub.rows[0]!.trial_ends_at };
  });
}
