// ADR-0004 §3 va §11: interpretatsiya natijasi va DecisionPolicy action'lari.

export const INTENTS = [
  'CREATE_DEBT',
  'CREATE_PAYMENT',
  'VIEW_CUSTOMER_BALANCE',
  'VIEW_CUSTOMER_HISTORY',
  'CREATE_CUSTOMER',
  'UNKNOWN',
] as const;
export type Intent = (typeof INTENTS)[number];

export const AMOUNT_KINDS = ['ABSOLUTE', 'FULL', 'FRACTION', 'NONE'] as const;
export type AmountKind = (typeof AMOUNT_KINDS)[number];

export const ACTIONS = [
  'ASK_AMOUNT',
  'ASK_CUSTOMER',
  'CONFIRM',
  'CONFIRM_FULL',
  'CONFIRM_FRACTION',
  'CONFIRM_NEW_CUSTOMER',
  'WARN_LARGE_AMOUNT',
  'REJECT_OVERPAY',
  'REJECT_NO_DEBT',
  'REJECT_UNKNOWN_CUSTOMER',
  'REJECT_INVALID_AMOUNT',
  'BLOCKED_SUBSCRIPTION',
  'SHOW_BALANCE',
  'SHOW_HISTORY',
  'SHOW_CUSTOMER_MENU',
  'CREATE_CUSTOMER_FLOW',
  'CANCELLED',
  'UNKNOWN',
] as const;
export type Action = (typeof ACTIONS)[number];

/** Draft (pending_operation) yaratadigan action'lar. Ledger'ga faqat tasdiqdan keyin yoziladi. */
export const DRAFT_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'CONFIRM',
  'CONFIRM_FULL',
  'CONFIRM_FRACTION',
  'CONFIRM_NEW_CUSTOMER',
  'WARN_LARGE_AMOUNT',
]);

export interface StructuredIntent {
  intent: Intent;
  /** Normalizatsiyalangan ism (qo'shimchasiz) yoki null. */
  customer: string | null;
  /** Faqat ABSOLUTE da, butun so'm. */
  amount: number | null;
  amountKind: AmountKind;
  /** Faqat FRACTION da: [surat, maxraj]. */
  fraction: readonly [number, number] | null;
  /** 0 = bugun, -1 = kecha. Hech qachon kelajak emas. */
  dateOffsetDays: number;
  /** Faqat RuleProvider chiqaradi; LLM'ga yuborilmaydi. */
  phone?: string;
  confidence: { intent: number; customer: number; amount: number; date: number };
}
