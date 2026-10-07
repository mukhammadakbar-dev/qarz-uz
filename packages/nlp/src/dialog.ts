import {
  normalizeName,
  normalizeText,
  type AmountKind,
  type Intent,
  type StructuredIntent,
} from '@nasiya/shared';
import { extractAmounts, singleAmount } from './amount.js';
import { bare, CANCEL_WORDS, ORDINALS } from './lexicon.js';
import { decide, type Decision, type DraftSpec } from './policy.js';
import type { CustomerRef, Resolution } from './resolver.js';

/**
 * Suhbat holati mashinasi (ADR-0004 §12). Toza reducer: tashqi dunyo `DialogEnv` orqali beriladi
 * (testlarda xotiradagi, productionda DB'dagi). Holat KONTEKST, moliyaviy haqiqat emas: har qadamda mijoz va
 * qoldiq `env.getCustomer` orqali qayta o'qiladi (TT §13).
 */

export interface PendingIntent {
  readonly intent: Intent;
  readonly amount: number | null;
  readonly amountKind: AmountKind;
  readonly fraction: readonly [number, number] | null;
  readonly dateOffsetDays: number;
}

export type DialogState =
  | { readonly kind: 'IDLE' }
  | {
      readonly kind: 'AWAIT_AMOUNT';
      readonly intent: 'CREATE_DEBT' | 'CREATE_PAYMENT';
      readonly customerId: string | null;
      readonly newCustomerName: string | null;
      readonly dateOffsetDays: number;
    }
  | {
      readonly kind: 'AWAIT_CUSTOMER';
      readonly pending: PendingIntent;
      readonly candidateIds: readonly string[];
    }
  | { readonly kind: 'AWAIT_CONFIRM'; readonly draft: DraftSpec }
  | {
      readonly kind: 'REJECTED_OVERPAY';
      readonly customerId: string;
      readonly dateOffsetDays: number;
    };

export const IDLE: DialogState = { kind: 'IDLE' };

export type DialogEvent =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'button'; readonly id: 'other_amount' | 'pay_max' | 'cancel' }
  | { readonly type: 'pick'; readonly index: number };

export type ParsedIntent = StructuredIntent & { readonly multiAmount?: boolean };

export interface DialogEnv {
  parse(text: string): ParsedIntent | Promise<ParsedIntent>;
  resolve(mention: string, alt: string | null): Promise<Resolution>;
  getCustomer(id: string): Promise<CustomerRef | null>;
  /** Obuna yozishga ruxsat beradimi. */
  readonly writable: boolean;
}

export interface StepResult {
  readonly state: DialogState;
  readonly decision: Decision;
  /** Oldingi tugallanmagan holat/draft yangi buyruq bilan almashtirildi (foydalanuvchiga aytiladi). */
  readonly supersededPrevious: boolean;
}

const unknownDecision = (): Decision => ({ action: 'UNKNOWN', intent: 'UNKNOWN', customer: null });

function isCancel(text: string): boolean {
  const compact = normalizeText(text)
    .split(/[^\p{L}\p{N}']+/u)
    .filter(Boolean)
    .map(bare)
    .join('');
  return CANCEL_WORDS.has(compact);
}

const isFullCommand = (p: ParsedIntent): boolean => p.intent !== 'UNKNOWN' && p.customer !== null;

function nextState(decision: Decision, pending: PendingIntent): DialogState {
  switch (decision.action) {
    case 'ASK_AMOUNT':
      return {
        kind: 'AWAIT_AMOUNT',
        intent: decision.intent === 'CREATE_PAYMENT' ? 'CREATE_PAYMENT' : 'CREATE_DEBT',
        customerId: decision.customer?.id ?? null,
        newCustomerName: decision.newCustomerName ?? null,
        dateOffsetDays: pending.dateOffsetDays,
      };
    case 'ASK_CUSTOMER':
      return {
        kind: 'AWAIT_CUSTOMER',
        pending,
        candidateIds: decision.candidates?.map((c) => c.id) ?? [],
      };
    case 'CONFIRM':
    case 'CONFIRM_FULL':
    case 'CONFIRM_FRACTION':
    case 'CONFIRM_NEW_CUSTOMER':
    case 'WARN_LARGE_AMOUNT':
      return decision.draft ? { kind: 'AWAIT_CONFIRM', draft: decision.draft } : IDLE;
    case 'REJECT_OVERPAY':
      return decision.customer
        ? {
            kind: 'REJECTED_OVERPAY',
            customerId: decision.customer.id,
            dateOffsetDays: pending.dateOffsetDays,
          }
        : IDLE;
    default:
      return IDLE;
  }
}

const toPending = (p: ParsedIntent): PendingIntent => ({
  intent: p.intent,
  amount: p.amount,
  amountKind: p.amountKind,
  fraction: p.fraction,
  dateOffsetDays: p.dateOffsetDays,
});

async function evaluate(parsed: ParsedIntent, env: DialogEnv): Promise<Decision> {
  const resolution = parsed.customer
    ? await env.resolve(parsed.customer, parsed.customerAlt ?? null)
    : null;
  return decide({ intent: parsed, resolution, writable: env.writable });
}

/** Mijoz allaqachon aniq (ID bo'yicha): berilgan niyat bilan qaror. */
async function evaluateForCustomer(
  pending: PendingIntent,
  customer: CustomerRef,
  env: DialogEnv,
): Promise<Decision> {
  return decide({
    intent: { ...pending, customer: customer.normalizedName, multiAmount: false },
    resolution: { kind: 'resolved', customer },
    writable: env.writable,
  });
}

async function startNew(text: string, env: DialogEnv, superseded: boolean): Promise<StepResult> {
  const parsed = await env.parse(text);
  const decision = await evaluate(parsed, env);
  return {
    state: nextState(decision, toPending(parsed)),
    decision,
    supersededPrevious: superseded,
  };
}

/** "birinchisi", "2", yoki nomzodning ismi/yorlig'i bo'yicha tanlash. Noaniq bo'lsa -1. */
function pickIndex(text: string, candidates: readonly CustomerRef[]): number {
  const t = normalizeText(text)
    .trim()
    .replace(/[.!?]+$/, '');
  const ordinal = ORDINALS[bare(t)] ?? ORDINALS[t];
  if (ordinal !== undefined) return ordinal - 1 < candidates.length ? ordinal - 1 : -1;
  const name = normalizeName(text);
  if (!name) return -1;
  const hits = candidates
    .map((c, i) => ({ c, i }))
    .filter(
      ({ c }) =>
        name === c.normalizedLabel ||
        name === c.normalizedName ||
        name === `${c.normalizedName} ${c.normalizedLabel ?? ''}`.trim(),
    );
  return hits.length === 1 ? hits[0]!.i : -1;
}

async function loadCandidates(ids: readonly string[], env: DialogEnv): Promise<CustomerRef[]> {
  const out: CustomerRef[] = [];
  for (const id of ids) {
    const c = await env.getCustomer(id);
    if (c) out.push(c);
  }
  return out;
}

export async function step(
  state: DialogState,
  event: DialogEvent,
  env: DialogEnv,
): Promise<StepResult> {
  const busy = state.kind !== 'IDLE';

  // ───────── Tugmalar ─────────
  if (event.type === 'button') {
    if (event.id === 'cancel') {
      return {
        state: IDLE,
        decision: { action: 'CANCELLED', intent: 'UNKNOWN', customer: null },
        supersededPrevious: false,
      };
    }
    if (event.id === 'other_amount' && state.kind === 'REJECTED_OVERPAY') {
      const customer = await env.getCustomer(state.customerId);
      return {
        state: {
          kind: 'AWAIT_AMOUNT',
          intent: 'CREATE_PAYMENT',
          customerId: state.customerId,
          newCustomerName: null,
          dateOffsetDays: state.dateOffsetDays,
        },
        decision: { action: 'ASK_AMOUNT', intent: 'CREATE_PAYMENT', customer },
        supersededPrevious: false,
      };
    }
    if (event.id === 'other_amount' && state.kind === 'AWAIT_CONFIRM') {
      const { draft } = state;
      const customer = draft.customerId ? await env.getCustomer(draft.customerId) : null;
      const decision: Decision = {
        action: 'ASK_AMOUNT',
        intent: draft.type === 'PAYMENT' ? 'CREATE_PAYMENT' : 'CREATE_DEBT',
        customer,
        ...(draft.newCustomerName ? { newCustomerName: draft.newCustomerName } : {}),
      };
      return {
        state: {
          kind: 'AWAIT_AMOUNT',
          intent: decision.intent === 'CREATE_PAYMENT' ? 'CREATE_PAYMENT' : 'CREATE_DEBT',
          customerId: draft.customerId,
          newCustomerName: draft.newCustomerName,
          dateOffsetDays: draft.dateOffsetDays,
        },
        decision,
        supersededPrevious: false,
      };
    }
    if (event.id === 'pay_max' && state.kind === 'REJECTED_OVERPAY') {
      const customer = await env.getCustomer(state.customerId);
      if (!customer) return { state: IDLE, decision: unknownDecision(), supersededPrevious: false };
      const pending: PendingIntent = {
        intent: 'CREATE_PAYMENT',
        amount: customer.balance,
        amountKind: 'ABSOLUTE',
        fraction: null,
        dateOffsetDays: state.dateOffsetDays,
      };
      const decision = await evaluateForCustomer(pending, customer, env);
      return { state: nextState(decision, pending), decision, supersededPrevious: false };
    }
    return { state, decision: unknownDecision(), supersededPrevious: false };
  }

  // ───────── Nomzod tanlash tugmasi ─────────
  if (event.type === 'pick') {
    if (state.kind !== 'AWAIT_CUSTOMER')
      return { state, decision: unknownDecision(), supersededPrevious: false };
    const candidates = await loadCandidates(state.candidateIds, env);
    const chosen = candidates[event.index];
    if (!chosen) return { state, decision: unknownDecision(), supersededPrevious: false };
    return continueWithCustomer(state.pending, chosen, env);
  }

  // ───────── Matn ─────────
  const { text } = event;
  if (isCancel(text)) {
    return {
      state: IDLE,
      decision: { action: 'CANCELLED', intent: 'UNKNOWN', customer: null },
      supersededPrevious: false,
    };
  }

  if (state.kind === 'AWAIT_AMOUNT') {
    const parsed = await env.parse(text);
    const newCommand =
      parsed.intent !== 'UNKNOWN' && (parsed.customer !== null || parsed.intent !== state.intent);
    if (newCommand) return startNew(text, env, true);

    const amounts = extractAmounts(normalizeText(text));
    const amount = singleAmount(amounts);
    const customer = state.customerId ? await env.getCustomer(state.customerId) : null;
    if (amount === null || (state.customerId && !customer)) {
      // Summa topilmadi (yoki bir nechta): qayta so'raymiz, holat saqlanadi
      return {
        state,
        decision: {
          action: 'ASK_AMOUNT',
          intent: state.intent,
          customer,
          ...(state.newCustomerName ? { newCustomerName: state.newCustomerName } : {}),
          multiAmount: amounts.length > 1,
        },
        supersededPrevious: false,
      };
    }
    const pending: PendingIntent = {
      intent: state.intent,
      amount,
      amountKind: 'ABSOLUTE',
      fraction: null,
      dateOffsetDays: state.dateOffsetDays,
    };
    const decision = customer
      ? await evaluateForCustomer(pending, customer, env)
      : decide({
          intent: { ...pending, customer: state.newCustomerName, multiAmount: false },
          resolution: { kind: 'none' },
          writable: env.writable,
        });
    // Rad etilsa (masalan manfiy summa) yana summa kutiladi
    const next =
      decision.action === 'REJECT_INVALID_AMOUNT' || decision.action === 'REJECT_OVERPAY'
        ? state
        : nextState(decision, pending);
    return { state: next, decision, supersededPrevious: false };
  }

  if (state.kind === 'AWAIT_CUSTOMER') {
    const candidates = await loadCandidates(state.candidateIds, env);
    if (candidates.length > 0) {
      const idx = pickIndex(text, candidates);
      if (idx >= 0) return continueWithCustomer(state.pending, candidates[idx]!, env);
    }
    const parsed = await env.parse(text);
    if (isFullCommand(parsed)) return startNew(text, env, true);
    if (candidates.length === 0) {
      // Ism kutilgan edi ("50 ming berdi" → "Qaysi mijoz?"): matnni ism sifatida qabul qilamiz
      const mention = normalizeName(text);
      if (mention) {
        const resolution = await env.resolve(mention, null);
        const decision = decide({
          intent: { ...state.pending, customer: mention, multiAmount: false },
          resolution,
          writable: env.writable,
        });
        return { state: nextState(decision, state.pending), decision, supersededPrevious: false };
      }
    }
    // Tushunarsiz javob: bir xil savol qayta beriladi
    return {
      state,
      decision: {
        action: 'ASK_CUSTOMER',
        intent: state.pending.intent,
        customer: null,
        candidates,
      },
      supersededPrevious: false,
    };
  }

  if (state.kind === 'AWAIT_CONFIRM' || state.kind === 'REJECTED_OVERPAY') {
    // Faqat summa yozilsa — tuzatish; to'liq buyruq — yangisi
    const parsed = await env.parse(text);
    if (parsed.intent === 'UNKNOWN' || parsed.customer === null) {
      const amount = singleAmount(extractAmounts(normalizeText(text)));
      const customerId = state.kind === 'AWAIT_CONFIRM' ? state.draft.customerId : state.customerId;
      const type = state.kind === 'AWAIT_CONFIRM' ? state.draft.type : 'PAYMENT';
      const dateOffsetDays =
        state.kind === 'AWAIT_CONFIRM' ? state.draft.dateOffsetDays : state.dateOffsetDays;
      const customer = customerId ? await env.getCustomer(customerId) : null;
      if (amount !== null && customer) {
        const pending: PendingIntent = {
          intent: type === 'PAYMENT' ? 'CREATE_PAYMENT' : 'CREATE_DEBT',
          amount,
          amountKind: 'ABSOLUTE',
          fraction: null,
          dateOffsetDays,
        };
        const decision = await evaluateForCustomer(pending, customer, env);
        return { state: nextState(decision, pending), decision, supersededPrevious: false };
      }
      return startNew(text, env, busy);
    }
    return startNew(text, env, true);
  }

  return startNew(text, env, false);
}

async function continueWithCustomer(
  pending: PendingIntent,
  chosen: CustomerRef,
  env: DialogEnv,
): Promise<StepResult> {
  // Qoldiq yangilanishi mumkin: tanlangan mijoz qayta o'qiladi
  const fresh = (await env.getCustomer(chosen.id)) ?? chosen;
  if (pending.intent === 'UNKNOWN') {
    return {
      state: IDLE,
      decision: { action: 'SHOW_CUSTOMER_MENU', intent: 'UNKNOWN', customer: fresh },
      supersededPrevious: false,
    };
  }
  const decision = await evaluateForCustomer(pending, fresh, env);
  return { state: nextState(decision, pending), decision, supersededPrevious: false };
}
