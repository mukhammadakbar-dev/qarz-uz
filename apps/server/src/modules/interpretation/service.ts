import {
  mergeIntents,
  parseRules,
  redactPii,
  type ParsedIntent,
  type RuleResult,
} from '@nasiya/nlp';
import type { Pool } from 'pg';
import { withTenant } from '../../db/tenant.js';
import type { Logger } from '../../observability/logger.js';
import type { DailyBudget } from '../../util/resilience.js';
import type { BusinessAccess } from '../tenancy/index.js';
import type { AIProvider, LlmCall } from './gemini.js';

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

export interface AiDeps {
  readonly provider: AIProvider;
  readonly budget: DailyBudget;
  /** always: har bir erkin matn; fallback: faqat rule parser aniq natija bermaganda. */
  readonly mode: 'always' | 'fallback';
}

export interface InterpreterDeps {
  readonly pool: Pool;
  readonly logger: Logger;
  readonly ai?: AiDeps | undefined;
}

/** Rule parser o'zi rad etgan xavfsizlik holatlarida LLM'ni chaqirishning ma'nosi yo'q (u bekor qila olmaydi). */
const SKIP_LLM_REASONS: ReadonlySet<string> = new Set([
  'negation_or_future',
  'delete_words',
  'invalid_chars',
  'too_long',
  'ambiguous_direction',
  'conflicting_verbs',
  'question',
  'give_first_without_dative',
  'invalid_name',
  'empty',
]);

function shouldConsult(rule: RuleResult, text: string, mode: 'always' | 'fallback'): boolean {
  if (text.length < 3 || !/\p{L}/u.test(text)) return false;
  if (rule.reason && SKIP_LLM_REASONS.has(rule.reason)) return false;
  if (mode === 'always') return true;
  return rule.intent === 'UNKNOWN' || rule.multiAmount || rule.confidence.intent < 0.9;
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
  const rule = parseRules(text);

  // LLM: faqat taxmin. Natija matnga "ildiz otgan" bo'lmasa rad etiladi (mergeIntents).
  let call: LlmCall | null = null;
  const ai = deps.ai;
  if (ai && shouldConsult(rule, text, ai.mode) && ai.budget.consume(access.businessId)) {
    call = await ai.provider.interpret(redactPii(text));
    if (call.error && call.error !== 'schema')
      deps.logger.warn(
        { error: call.error },
        'LLM chaqiruvi muvaffaqiyatsiz, rule natijasi ishlatiladi',
      );
  }
  const merged = mergeIntents(rule, call?.intent ?? null);
  const parsed: ParsedIntent = merged.parsed;
  const latencyMs = Date.now() - started;

  let interpretationId: string | null = null;
  try {
    const { rows } = await withTenant(
      deps.pool,
      { businessId: access.businessId, userId: access.userId },
      (c) =>
        c.query<{ id: string }>(
          `INSERT INTO ai_interpretations
           (business_id, user_id, input_redacted, rule_output, llm_output, final_intent, provider, model, prompt_version, latency_ms)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8, $9, $10) RETURNING id`,
          [
            access.businessId,
            access.userId,
            redactPii(text).slice(0, 1000),
            JSON.stringify(summarize(rule)),
            call
              ? JSON.stringify({
                  error: call.error,
                  latencyMs: call.latencyMs,
                  output: call.raw ?? null,
                })
              : null,
            JSON.stringify({
              ...summarize(parsed),
              agreement: merged.agreement,
              note: merged.note ?? null,
            }),
            call ? 'rules+gemini' : 'rules',
            call && ai ? ai.provider.model : null,
            call && ai ? ai.provider.promptVersion : null,
            call ? call.latencyMs : latencyMs,
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
