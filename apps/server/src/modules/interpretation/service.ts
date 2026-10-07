import { parseRules, redactPii, type ParsedIntent } from '@nasiya/nlp';
import type { Pool } from 'pg';
import { withTenant } from '../../db/tenant.js';
import type { Logger } from '../../observability/logger.js';
import type { BusinessAccess } from '../tenancy/index.js';

/**
 * Interpretatsiya (ADR-0004): matn → StructuredIntent. AI faqat taxmin qiladi; yakuniy qaror resolver/policy'da.
 * Har bir tahlil `ai_interpretations` ga yoziladi (matn FAQAT redaksiya qilingan ko'rinishda).
 */

export type InterpretationOutcome =
  'CONFIRMED' | 'EDITED' | 'CANCELLED' | 'REJECTED' | 'EXPIRED' | 'CLARIFIED' | 'UNKNOWN';

export interface Interpretation {
  readonly parsed: ParsedIntent;
  readonly interpretationId: string | null;
}

export interface InterpreterDeps {
  readonly pool: Pool;
  readonly logger: Logger;
}

const summarize = (p: ParsedIntent) => ({
  intent: p.intent,
  amountKind: p.amountKind,
  hasCustomer: p.customer !== null,
  hasAmount: p.amount !== null,
  reason: p.reason ?? null,
});

export async function interpret(
  deps: InterpreterDeps,
  access: BusinessAccess,
  text: string,
): Promise<Interpretation> {
  const started = Date.now();
  const parsed: ParsedIntent = parseRules(text);
  const latencyMs = Date.now() - started;

  let interpretationId: string | null = null;
  try {
    const { rows } = await withTenant(
      deps.pool,
      { businessId: access.businessId, userId: access.userId },
      (c) =>
        c.query<{ id: string }>(
          `INSERT INTO ai_interpretations
           (business_id, user_id, input_redacted, rule_output, final_intent, provider, latency_ms)
         VALUES ($1, $2, $3, $4::jsonb, $4::jsonb, 'rules', $5) RETURNING id`,
          [
            access.businessId,
            access.userId,
            redactPii(text).slice(0, 1000),
            JSON.stringify(summarize(parsed)),
            latencyMs,
          ],
        ),
    );
    interpretationId = rows[0]!.id;
  } catch (error) {
    // Jurnal yozilmasa ham foydalanuvchi xizmatsiz qolmasin
    deps.logger.warn({ err: error }, 'interpretatsiya jurnali yozilmadi');
  }
  return { parsed, interpretationId };
}

export async function setOutcome(
  deps: InterpreterDeps,
  access: BusinessAccess,
  interpretationId: string | null,
  outcome: InterpretationOutcome,
): Promise<void> {
  if (!interpretationId) return;
  try {
    await withTenant(deps.pool, { businessId: access.businessId, userId: access.userId }, (c) =>
      c.query('UPDATE ai_interpretations SET outcome = $2 WHERE id = $1 AND outcome IS NULL', [
        interpretationId,
        outcome,
      ]),
    );
  } catch (error) {
    deps.logger.warn({ err: error }, 'interpretatsiya natijasi yozilmadi');
  }
}
