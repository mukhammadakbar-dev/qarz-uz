import {
  DRAFT_ACTIONS,
  isLargeAmount,
  MAX_AMOUNT_UZS,
  type Action,
  type Intent,
  type StructuredIntent,
} from '@nasiya/shared';
import type { CustomerRef, Resolution } from './resolver.js';

/**
 * DecisionPolicy (ADR-0004 §9, §11): toza funksiya. Hech qanday I/O yo'q, hech narsa yozmaydi.
 * AI taxmin qilishi mumkin; BU yerda taxmin YO'Q: noaniq bo'lsa savol, mumkin bo'lmasa rad.
 */

export type DraftKind = 'ABSOLUTE' | 'FULL' | 'FRACTION';

/** Tasdiqdan keyin LedgerService'ga beriladigan niyat (pending_operations.payload). */
export interface DraftSpec {
  readonly type: 'DEBT' | 'PAYMENT';
  /** Mavjud mijoz ID si; yangi mijoz bo'lsa null. */
  readonly customerId: string | null;
  readonly newCustomerName: string | null;
  readonly amount: number;
  readonly dateOffsetDays: number;
  /** Qaror paytidagi qoldiq: tasdiqda o'zgargan bo'lsa qayta so'raladi (ADR-0003). */
  readonly expectedBalance: number;
  readonly kind: DraftKind;
}

export interface Decision {
  readonly action: Action;
  readonly intent: Intent;
  readonly customer: CustomerRef | null;
  readonly candidates?: readonly CustomerRef[];
  /** Operatsiya summasi (FULL/FRACTION da hisoblangan). */
  readonly amount?: number;
  readonly balanceBefore?: number;
  readonly balanceAfter?: number;
  readonly maxPayable?: number;
  readonly newCustomerName?: string;
  /** Mijoz yaratishda: shu ism bor, yorliq so'raladi. */
  readonly askLabel?: boolean;
  /** Katta summa ogohlantirishi (WARN_LARGE_AMOUNT yoki yangi mijoz bilan). */
  readonly warnLarge?: boolean;
  /** Bir nechta har xil summa topilgan edi. */
  readonly multiAmount?: boolean;
  readonly draft?: DraftSpec;
}

export interface PolicyInput {
  readonly intent: Pick<
    StructuredIntent,
    'intent' | 'customer' | 'amount' | 'amountKind' | 'fraction' | 'dateOffsetDays'
  > & { readonly multiAmount?: boolean };
  /** Mijoz ko'rsatilmagan bo'lsa null. */
  readonly resolution: Resolution | null;
  /** Obuna yozishga ruxsat beradimi (EXPIRED emas). */
  readonly writable: boolean;
}

const validAmount = (n: number): boolean =>
  Number.isSafeInteger(n) && n >= 1 && n <= MAX_AMOUNT_UZS;

function withDraft(d: Omit<Decision, 'draft'>, draft: DraftSpec | undefined): Decision {
  return draft && DRAFT_ACTIONS.has(d.action) ? { ...d, draft } : d;
}

export function decide(input: PolicyInput): Decision {
  const { intent: i, resolution, writable } = input;
  const base = { intent: i.intent, multiAmount: i.multiAmount ?? false } as const;
  const none = (action: Action, extra: Partial<Decision> = {}): Decision => ({
    ...base,
    action,
    customer: null,
    ...extra,
  });

  // Mijoz yaratish
  if (i.intent === 'CREATE_CUSTOMER') {
    if (!writable) return none('BLOCKED_SUBSCRIPTION');
    const exists =
      resolution?.kind === 'resolved' ||
      (resolution?.kind === 'ambiguous' && resolution.exactCount > 0);
    return none('CREATE_CUSTOMER_FLOW', {
      newCustomerName: i.customer ?? '',
      ...(exists ? { askLabel: true } : {}),
    });
  }

  // Tushunilmagan: faqat ism bo'lsa — mijoz menyusi / tanlash
  if (i.intent === 'UNKNOWN') {
    if (!i.customer || !resolution) return none('UNKNOWN');
    if (resolution.kind === 'resolved')
      return { ...base, action: 'SHOW_CUSTOMER_MENU', customer: resolution.customer };
    if (resolution.kind === 'ambiguous') {
      return { ...base, action: 'ASK_CUSTOMER', customer: null, candidates: resolution.candidates };
    }
    return none('UNKNOWN');
  }

  const isWrite = i.intent === 'CREATE_DEBT' || i.intent === 'CREATE_PAYMENT';
  if (isWrite && !writable) return none('BLOCKED_SUBSCRIPTION');

  if (!i.customer || !resolution) return none('ASK_CUSTOMER');
  if (resolution.kind === 'ambiguous') {
    return { ...base, action: 'ASK_CUSTOMER', customer: null, candidates: resolution.candidates };
  }

  const isView = i.intent === 'VIEW_CUSTOMER_BALANCE' || i.intent === 'VIEW_CUSTOMER_HISTORY';

  if (resolution.kind === 'none') {
    if (isView || i.intent === 'CREATE_PAYMENT') return none('REJECT_UNKNOWN_CUSTOMER');
    // CREATE_DEBT: yangi mijoz (tasdiq bilan)
    if (i.amountKind === 'NONE' || i.amount === null)
      return none('ASK_AMOUNT', { newCustomerName: i.customer });
    if (!validAmount(i.amount)) return none('REJECT_INVALID_AMOUNT');
    return withDraft(
      {
        ...base,
        action: 'CONFIRM_NEW_CUSTOMER',
        customer: null,
        newCustomerName: i.customer,
        amount: i.amount,
        balanceBefore: 0,
        balanceAfter: i.amount,
        ...(isLargeAmount(i.amount) ? { warnLarge: true } : {}),
      },
      {
        type: 'DEBT',
        customerId: null,
        newCustomerName: i.customer,
        amount: i.amount,
        dateOffsetDays: i.dateOffsetDays,
        expectedBalance: 0,
        kind: 'ABSOLUTE',
      },
    );
  }

  const customer = resolution.customer;
  const balance = customer.balance;
  const known = { ...base, customer };

  if (i.intent === 'VIEW_CUSTOMER_BALANCE')
    return { ...known, action: 'SHOW_BALANCE', balanceBefore: balance };
  if (i.intent === 'VIEW_CUSTOMER_HISTORY')
    return { ...known, action: 'SHOW_HISTORY', balanceBefore: balance };

  if (i.intent === 'CREATE_DEBT') {
    if (i.amountKind === 'NONE' || i.amount === null)
      return { ...known, action: 'ASK_AMOUNT', balanceBefore: balance };
    if (!validAmount(i.amount)) return { ...known, action: 'REJECT_INVALID_AMOUNT' };
    return withDraft(
      {
        ...known,
        action: isLargeAmount(i.amount) ? 'WARN_LARGE_AMOUNT' : 'CONFIRM',
        amount: i.amount,
        balanceBefore: balance,
        balanceAfter: balance + i.amount,
      },
      {
        type: 'DEBT',
        customerId: customer.id,
        newCustomerName: null,
        amount: i.amount,
        dateOffsetDays: i.dateOffsetDays,
        expectedBalance: balance,
        kind: 'ABSOLUTE',
      },
    );
  }

  // CREATE_PAYMENT
  if (i.amountKind === 'NONE') return { ...known, action: 'ASK_AMOUNT', balanceBefore: balance };
  if (i.amountKind === 'ABSOLUTE' && (i.amount === null || !validAmount(i.amount))) {
    return { ...known, action: 'REJECT_INVALID_AMOUNT' };
  }
  if (balance === 0) return { ...known, action: 'REJECT_NO_DEBT', balanceBefore: 0, maxPayable: 0 };

  let amount: number;
  let kind: DraftKind;
  let action: Action;
  if (i.amountKind === 'FULL') {
    amount = balance;
    kind = 'FULL';
    action = 'CONFIRM_FULL';
  } else if (i.amountKind === 'FRACTION' && i.fraction) {
    // Pastga yaxlitlanadi: to'lov hech qachon qoldiqdan oshmaydi (ADR-0004 §9.7)
    amount = Math.floor((balance * i.fraction[0]) / i.fraction[1]);
    if (amount <= 0) return { ...known, action: 'REJECT_INVALID_AMOUNT' };
    kind = 'FRACTION';
    action = 'CONFIRM_FRACTION';
  } else {
    amount = i.amount!;
    kind = 'ABSOLUTE';
    action = isLargeAmount(amount) ? 'WARN_LARGE_AMOUNT' : 'CONFIRM';
  }

  // Ortiqcha to'lov HECH QACHON (Q1)
  if (amount > balance) {
    return {
      ...known,
      action: 'REJECT_OVERPAY',
      amount,
      balanceBefore: balance,
      maxPayable: balance,
    };
  }
  return withDraft(
    { ...known, action, amount, balanceBefore: balance, balanceAfter: balance - amount },
    {
      type: 'PAYMENT',
      customerId: customer.id,
      newCustomerName: null,
      amount,
      dateOffsetDays: i.dateOffsetDays,
      expectedBalance: balance,
      kind,
    },
  );
}
