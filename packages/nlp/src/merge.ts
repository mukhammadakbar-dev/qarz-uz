import { INTENTS, normalizeName, type AmountKind, type Intent } from '@nasiya/shared';
import { FRACTION_HALF, FRACTION_QUARTER, FULL_WORDS, bare } from './lexicon.js';
import type { ParsedIntent } from './dialog.js';
import type { RuleResult } from './rules.js';

/**
 * Rule va LLM natijalarini birlashtirish (ADR-0004 §7–§8). TOZA funksiya.
 * Asosiy prinsip: LLM faqat TAXMIN beradi. Uning chiqishi matnga "ildiz otgan" (grounded) bo'lmasa rad etiladi,
 * rule parserning xavfsizlik rad etishlari (inkor, kelasi zamon, yo'nalish...) LLM tomonidan bekor qilinmaydi,
 * kelishmovchilikda hech narsa taxmin qilinmaydi.
 */

export interface LlmIntent {
  readonly intent: Intent;
  readonly customer: string | null;
  readonly amount: number | null;
  readonly amountKind: AmountKind;
  readonly fraction: readonly [number, number] | null;
  readonly dateOffsetDays: number;
}

export type Agreement = 'AGREE' | 'RULE_ONLY' | 'LLM_ONLY' | 'CONFLICT' | 'LLM_REJECTED';

export interface MergeResult {
  readonly parsed: ParsedIntent & { readonly source: 'rules' | 'rules+llm' | 'llm' };
  readonly agreement: Agreement;
  /** LLM rad etilgan yoki kelishmovchilik bo'lgan sabab (jurnal uchun). */
  readonly note?: string;
}

/** Bu sabablar bo'yicha rule UNKNOWN qaytargan bo'lsa, LLM uni bekor qila OLMAYDI. */
const SAFETY_REASONS: ReadonlySet<string> = new Set([
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

const SUFFIX = '(?:ning|dan|ga|ka|qa|ni|da)?';
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** LLM bergan ism matnning o'zida (qo'shimcha bilan yoki qo'shimchasiz) bormi? */
export function nameIsGrounded(normalizedText: string, name: string): boolean {
  const n = normalizeName(name);
  if (!n || n.length > 60) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(n)}${SUFFIX}(?![\\p{L}\\p{N}])`, 'u').test(
    normalizedText,
  );
}

function hasMarker(normalizedText: string, kind: 'FULL' | 'FRACTION'): boolean {
  const tokens = normalizedText.split(/[^\p{L}\p{N}']+/u).map(bare);
  if (kind === 'FULL') return tokens.some((t) => FULL_WORDS.has(t));
  return tokens.some((t) => FRACTION_HALF.has(t) || FRACTION_QUARTER.has(t) || t === 'uchdan');
}

/** LLM chiqishini matnga qarab tekshiradi. Rad etish sababi yoki null. */
export function groundingProblem(rule: RuleResult, llm: LlmIntent): string | null {
  if (!INTENTS.includes(llm.intent)) return 'bad_intent';
  if (!Number.isInteger(llm.dateOffsetDays) || llm.dateOffsetDays > 0 || llm.dateOffsetDays < -365)
    return 'bad_date';
  if (llm.amountKind === 'ABSOLUTE') {
    if (!Number.isSafeInteger(llm.amount)) return 'bad_amount';
    // LLM o'ylab chiqargan summa bo'lishi mumkin emas: matndagi nomzodlardan biri bo'lishi shart
    if (!rule.amountCandidates.some((c) => c.value === llm.amount)) return 'amount_not_in_text';
  } else if (llm.amount !== null) {
    return 'amount_with_non_absolute';
  }
  if (
    llm.amountKind === 'FULL' &&
    (llm.intent !== 'CREATE_PAYMENT' || !hasMarker(rule.normalized, 'FULL'))
  )
    return 'full_not_in_text';
  if (llm.amountKind === 'FRACTION') {
    const f = llm.fraction;
    if (
      llm.intent !== 'CREATE_PAYMENT' ||
      !f ||
      !(f[0] > 0 && f[0] < f[1]) ||
      !hasMarker(rule.normalized, 'FRACTION')
    ) {
      return 'fraction_not_in_text';
    }
  }
  if (llm.customer !== null && !nameIsGrounded(rule.normalized, llm.customer))
    return 'customer_not_in_text';
  return null;
}

const withSource = (
  parsed: ParsedIntent,
  source: 'rules' | 'rules+llm' | 'llm',
): ParsedIntent & { source: typeof source } => ({ ...parsed, source });

const sameName = (rule: RuleResult, llmName: string | null): boolean => {
  if (rule.customer === null || llmName === null) return rule.customer === llmName;
  const n = normalizeName(llmName);
  return (
    n === rule.customer ||
    n === rule.customerAlt ||
    n.replace(new RegExp(`${SUFFIX}$`), '') === rule.customer
  );
};

const capitalize = (s: string): string => {
  const lower = s.trim().toLocaleLowerCase();
  return lower.replace(
    /(^|[\s-])(\p{L})/gu,
    (_m, sep: string, ch: string) => sep + ch.toLocaleUpperCase(),
  );
};

export function mergeIntents(rule: RuleResult, llm: LlmIntent | null): MergeResult {
  if (llm === null) return { parsed: withSource(rule, 'rules'), agreement: 'RULE_ONLY' };

  const problem = groundingProblem(rule, llm);
  if (problem)
    return { parsed: withSource(rule, 'rules'), agreement: 'LLM_REJECTED', note: problem };

  // ───── Rule UNKNOWN ─────
  if (rule.intent === 'UNKNOWN') {
    if (rule.reason && SAFETY_REASONS.has(rule.reason)) {
      return {
        parsed: withSource(rule, 'rules'),
        agreement: 'RULE_ONLY',
        note: `safety:${rule.reason}`,
      };
    }
    if (llm.intent === 'UNKNOWN') return { parsed: withSource(rule, 'rules'), agreement: 'AGREE' };
    const customerNorm = llm.customer ? normalizeName(llm.customer) : null;
    const accepted: ParsedIntent = {
      intent: llm.intent,
      customer: customerNorm || null,
      customerAlt: null,
      customerDisplay: llm.customer ? capitalize(llm.customer) : null,
      amount: llm.amount,
      amountKind: llm.amountKind,
      fraction: llm.fraction ? [llm.fraction[0], llm.fraction[1]] : null,
      dateOffsetDays: llm.dateOffsetDays,
      multiAmount: rule.multiAmount,
      confidence: {
        intent: 0.6,
        customer: llm.customer ? 0.6 : 0,
        amount: llm.amount !== null ? 0.6 : 0,
        date: 1,
      },
    };
    return { parsed: withSource(accepted, 'llm'), agreement: 'LLM_ONLY' };
  }

  // ───── Rule aniq ─────
  if (llm.intent === 'UNKNOWN')
    return { parsed: withSource(rule, 'rules'), agreement: 'RULE_ONLY' };

  const conflict = (note: string): MergeResult => ({
    parsed: withSource(
      {
        ...rule,
        intent: 'UNKNOWN',
        customer: null,
        customerAlt: null,
        amount: null,
        amountKind: 'NONE',
        fraction: null,
        reason: 'llm_conflict',
      },
      'rules+llm',
    ),
    agreement: 'CONFLICT',
    note,
  });

  if (llm.intent !== rule.intent) return conflict('intent');
  if (!sameName(rule, llm.customer)) return conflict('customer');
  if (llm.dateOffsetDays !== rule.dateOffsetDays) return conflict('date');
  if (llm.amountKind !== rule.amountKind && !(rule.multiAmount && llm.amountKind === 'ABSOLUTE'))
    return conflict('amount_kind');
  if (JSON.stringify(llm.fraction ?? null) !== JSON.stringify(rule.fraction ?? null))
    return conflict('fraction');

  if (rule.multiAmount) {
    // Bir nechta summa: rule summa tanlamagan, LLM ham tanlay olmaydi (xavfsizlik)
    return {
      parsed: withSource(rule, 'rules+llm'),
      agreement: 'AGREE',
      note: 'multi_amount_kept_null',
    };
  }
  if ((llm.amount ?? null) !== (rule.amount ?? null)) {
    // Summa kelishmadi: summa so'raladi, qolgani saqlanadi
    return {
      parsed: withSource(
        { ...rule, amount: null, amountKind: 'NONE', fraction: null },
        'rules+llm',
      ),
      agreement: 'CONFLICT',
      note: 'amount',
    };
  }
  return {
    parsed: withSource({ ...rule, confidence: { ...rule.confidence, intent: 1 } }, 'rules+llm'),
    agreement: 'AGREE',
  };
}
