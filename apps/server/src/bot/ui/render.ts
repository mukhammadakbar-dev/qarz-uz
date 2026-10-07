import { formatUzs } from '@nasiya/shared';
import { displayName, type CustomerRef, type Decision } from '@nasiya/nlp';
import type { Locale } from '@nasiya/shared';
import type { MessageKey, Params } from '../../i18n/index.js';

/**
 * Qarorni (Decision) foydalanuvchi xabariga aylantiradi. TOZA funksiya: Telegram'dan mustaqil, testlanadi.
 * Callback ma'lumotlari (64 bayt chegarasi): d:<draft>:ok|edit|no, c:<n>|c:new, o:max|o:other, x:cancel,
 * m:<customer>:debt|pay|hist.
 */

export interface Button {
  readonly text: string;
  readonly data: string;
}

export interface Rendered {
  readonly text: string;
  readonly buttons: readonly (readonly Button[])[];
}

export interface RenderContext {
  readonly locale: Locale;
  readonly t: (key: MessageKey, params?: Params) => string;
  /** Qoralama yaratilgan bo'lsa uning ID si (tasdiq tugmalari uchun). */
  readonly draftId: string | null;
  readonly supportLine: string;
}

const money = (n: number, rc: RenderContext) => formatUzs(n, rc.locale);

function fractionLabel(fraction: readonly [number, number] | undefined, rc: RenderContext): string {
  const [n, d] = fraction ?? [0, 0];
  if (n === 1 && d === 2) return rc.t('fraction.half');
  if (n === 1 && d === 3) return rc.t('fraction.third');
  if (n === 1 && d === 4) return rc.t('fraction.quarter');
  return rc.t('fraction.other', { n, d });
}

const cancelButton = (rc: RenderContext): Button => ({
  text: rc.t('button.cancel'),
  data: 'x:cancel',
});

export function customerMenuButtons(customerId: string, rc: RenderContext): Button[][] {
  return [
    [
      { text: rc.t('button.addDebt'), data: `m:${customerId}:debt` },
      { text: rc.t('button.addPayment'), data: `m:${customerId}:pay` },
      { text: rc.t('button.history'), data: `m:${customerId}:hist` },
    ],
  ];
}

const nameOf = (c: CustomerRef | null, fallback = ''): string => (c ? displayName(c) : fallback);

/** `null` — bu qaror uchun maxsus ishlov kerak (tarix, mijoz yaratish). */
export function renderDecision(
  decision: Decision,
  rc: RenderContext,
  extra: { reason?: string | undefined } = {},
): Rendered | null {
  const { t } = rc;
  const draftId = rc.draftId;
  const confirmButtons = (labels: { ok: Button; edit?: Button | undefined }): Button[][] => {
    const rows: Button[][] = [[labels.ok]];
    if (labels.edit) rows[0]!.push(labels.edit);
    rows.push([cancelButton(rc)]);
    return rows;
  };
  const warn =
    decision.warnLarge || decision.action === 'WARN_LARGE_AMOUNT'
      ? t('warn.large', { amount: money(decision.amount ?? 0, rc) })
      : '';
  const saveButtons = (): Button[][] =>
    draftId
      ? confirmButtons({
          ok: { text: t('button.save'), data: `d:${draftId}:ok` },
          edit: { text: t('button.edit'), data: `d:${draftId}:edit` },
        })
      : [];

  switch (decision.action) {
    case 'CONFIRM':
    case 'WARN_LARGE_AMOUNT': {
      const name = nameOf(decision.customer);
      const isPayment = decision.intent === 'CREATE_PAYMENT';
      const body = isPayment
        ? t('confirm.payment', {
            name,
            amount: money(decision.amount!, rc),
            after: money(decision.balanceAfter!, rc),
          })
        : t('confirm.debt', {
            name,
            amount: money(decision.amount!, rc),
            before: money(decision.balanceBefore!, rc),
            after: money(decision.balanceAfter!, rc),
          });
      return { text: warn + body, buttons: saveButtons() };
    }
    case 'CONFIRM_NEW_CUSTOMER':
      return {
        text:
          warn +
          t('confirm.debtNew', {
            name: decision.newCustomerName ?? '',
            amount: money(decision.amount!, rc),
          }),
        buttons: saveButtons(),
      };
    case 'CONFIRM_FULL':
      return {
        text: t('confirm.full', {
          name: nameOf(decision.customer),
          amount: money(decision.amount!, rc),
        }),
        buttons: draftId
          ? [
              [
                {
                  text: t('button.yesFull', { amount: money(decision.amount!, rc) }),
                  data: `d:${draftId}:ok`,
                },
              ],
              [{ text: t('button.otherAmount'), data: `d:${draftId}:edit` }],
              [cancelButton(rc)],
            ]
          : [],
      };
    case 'CONFIRM_FRACTION':
      return {
        text: t('confirm.fraction', {
          name: nameOf(decision.customer),
          balance: money(decision.balanceBefore!, rc),
          fraction: fractionLabel(decision.fraction, rc),
          amount: money(decision.amount!, rc),
        }),
        buttons: draftId
          ? [
              [{ text: t('button.yes'), data: `d:${draftId}:ok` }],
              [{ text: t('button.edit'), data: `d:${draftId}:edit` }],
              [cancelButton(rc)],
            ]
          : [],
      };
    case 'ASK_AMOUNT': {
      let text: string;
      if (decision.multiAmount) text = t('ask.amountMulti');
      else if (decision.newCustomerName && !decision.customer)
        text = t('ask.amountNew', { name: decision.newCustomerName });
      else if (decision.intent === 'CREATE_PAYMENT')
        text = t('ask.amountPayment', { name: nameOf(decision.customer) });
      else text = t('ask.amountDebt', { name: nameOf(decision.customer) });
      return { text, buttons: [[cancelButton(rc)]] };
    }
    case 'ASK_CUSTOMER': {
      const candidates = decision.candidates ?? [];
      if (candidates.length === 0)
        return { text: t('ask.customerName'), buttons: [[cancelButton(rc)]] };
      const rows: Button[][] = candidates.map((c, i) => [
        { text: `${displayName(c)} — ${money(c.balance, rc)}`, data: `c:${i}` },
      ]);
      // Yangi mijoz: faqat nasiya (yoki mijoz menyusi) uchun mantiqli; to'lov mavjud mijozga yoziladi
      if (decision.intent !== 'CREATE_PAYMENT')
        rows.push([{ text: t('button.newCustomer'), data: 'c:new' }]);
      rows.push([cancelButton(rc)]);
      return { text: t('ask.customer'), buttons: rows };
    }
    case 'REJECT_OVERPAY':
      return {
        text: t('reject.overpay', {
          name: nameOf(decision.customer),
          balance: money(decision.balanceBefore!, rc),
          amount: money(decision.amount!, rc),
        }),
        buttons: [
          [
            {
              text: t('button.payMax', { amount: money(decision.maxPayable!, rc) }),
              data: 'o:max',
            },
          ],
          [{ text: t('button.otherAmount'), data: 'o:other' }],
          [cancelButton(rc)],
        ],
      };
    case 'REJECT_NO_DEBT':
      return {
        text: t('reject.noDebt', { name: nameOf(decision.customer), balance: money(0, rc) }),
        buttons: [],
      };
    case 'REJECT_UNKNOWN_CUSTOMER':
      return { text: t('reject.unknownCustomer', { name: decision.mention ?? '' }), buttons: [] };
    case 'REJECT_INVALID_AMOUNT':
      return { text: t('reject.invalidAmount'), buttons: [] };
    case 'BLOCKED_SUBSCRIPTION':
      return {
        text: [t('blocked.subscription'), rc.supportLine].filter(Boolean).join('\n'),
        buttons: [],
      };
    case 'SHOW_BALANCE':
    case 'SHOW_CUSTOMER_MENU': {
      const c = decision.customer!;
      const text =
        c.balance > 0
          ? t('view.balance', { name: displayName(c), balance: money(c.balance, rc) })
          : t('view.balanceZero', { name: displayName(c) });
      return { text, buttons: customerMenuButtons(c.id, rc) };
    }
    case 'CANCELLED':
      return { text: t('cancelled'), buttons: [] };
    case 'UNKNOWN':
      if (extra.reason === 'ambiguous_direction')
        return { text: t('unknown.direction'), buttons: [] };
      if (extra.reason === 'too_long') return { text: t('unknown.tooLong'), buttons: [] };
      return { text: t('fallback.unknown'), buttons: [] };
    case 'SHOW_HISTORY':
    case 'CREATE_CUSTOMER_FLOW':
      return null;
    default:
      return { text: t('fallback.unknown'), buttons: [] };
  }
}
