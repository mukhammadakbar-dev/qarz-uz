import type { CustomerRef, DialogEnv, ParsedIntent } from '@nasiya/nlp';
import { resolveCustomer } from '@nasiya/nlp';
import type { Pool, PoolClient } from 'pg';
import { isBusinessWritable } from '../billing/guard.js';
import { withBusiness, type BusinessAccess } from '../tenancy/index.js';

/** Dialog reducer uchun DB'dagi muhit (testlarda bu xotiradagi `makeEnv` edi). Barcha so'rovlar RLS ostida. */

interface RefRow {
  id: string;
  name: string;
  normalized_name: string;
  label: string | null;
  normalized_label: string | null;
  balance: string;
}

const REF_SELECT = `
  SELECT c.id, c.name, c.normalized_name, c.label, c.normalized_label, b.balance
    FROM customers c
    JOIN customer_balances b ON b.customer_id = c.id AND b.business_id = c.business_id`;

const toRef = (r: RefRow): CustomerRef => ({
  id: r.id,
  name: r.name,
  normalizedName: r.normalized_name,
  label: r.label,
  normalizedLabel: r.normalized_label,
  balance: Number(r.balance),
});

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/**
 * Nomzodlar: ismning birinchi so'zi bo'yicha prefiks (ikki yo'nalishda) yoki trigram o'xshashlik. Aniq tanlashni
 * `resolveCustomer` (toza funksiya) bajaradi.
 */
async function candidates(
  c: PoolClient,
  mention: string,
  alt: string | null,
): Promise<CustomerRef[]> {
  const firsts = [
    ...new Set([mention, ...(alt ? [alt] : [])].map((v) => v.split(' ')[0]!).filter(Boolean)),
  ];
  if (firsts.length === 0) return [];
  // normalized_name faqat harf/raqam/'/-/bo'shliqdan iborat, shuning uchun teskari LIKE xavfsiz;
  // to'g'ri yo'nalishdagi LIKE uchun qidiruv qiymati escape qilinadi.
  const { rows } = await c.query<RefRow>(
    `${REF_SELECT}
      WHERE c.status = 'ACTIVE'
        AND EXISTS (
          SELECT 1 FROM unnest($1::text[], $2::text[]) AS f(v, pattern)
           WHERE c.normalized_name LIKE f.pattern || '%'
              OR f.v LIKE c.normalized_name || '%'
              OR c.normalized_name % f.v
        )
      ORDER BY c.normalized_name, c.created_at
      LIMIT 60`,
    [firsts, firsts.map(escapeLike)],
  );
  return rows.map(toRef);
}

export interface AssistantEnv extends DialogEnv {
  /** Oxirgi tahlil jurnali yozuvining ID si (qoralama bilan bog'lash uchun). */
  lastInterpretationId(): string | null;
}

export type InterpretFn = (
  text: string,
) => Promise<{ parsed: ParsedIntent; interpretationId: string | null }>;

export async function createAssistantEnv(
  pool: Pool,
  access: BusinessAccess,
  interpret: InterpretFn,
): Promise<AssistantEnv> {
  const writable = await isBusinessWritable(pool, access);
  const cache = new Map<string, ParsedIntent>();
  let lastId: string | null = null;

  return {
    writable,
    lastInterpretationId: () => lastId,
    // Bir qadamda reducer parse'ni bir necha marta chaqirishi mumkin: bir xil matn faqat bir marta tahlil qilinadi
    async parse(text) {
      const cached = cache.get(text);
      if (cached) return cached;
      const { parsed, interpretationId } = await interpret(text);
      cache.set(text, parsed);
      lastId = interpretationId;
      return parsed;
    },
    async resolve(mention, alt) {
      const refs = await withBusiness(
        pool,
        access,
        (c) => candidates(c, mention, alt),
        'customer.view',
      );
      return resolveCustomer(mention, alt, refs);
    },
    async getCustomer(id) {
      const refs = await withBusiness(
        pool,
        access,
        async (c) =>
          (await c.query<RefRow>(`${REF_SELECT} WHERE c.id = $1 AND c.status = 'ACTIVE'`, [id]))
            .rows,
        'customer.view',
      ).catch(() => []);
      return refs[0] ? toRef(refs[0]) : null;
    },
  };
}
