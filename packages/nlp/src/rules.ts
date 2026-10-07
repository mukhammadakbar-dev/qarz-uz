import { normalizeText, type StructuredIntent } from '@nasiya/shared';
import { extractAmounts, maskNonAmounts, singleAmount, type AmountCandidate } from './amount.js';
import {
  bare,
  DEBT_VERBS,
  DELETE_WORDS,
  FILLERS,
  FRACTION_HALF,
  FRACTION_QUARTER,
  FULL_WORDS,
  GIVE_FIRST_PERSON,
  GREETINGS,
  HISTORY_WORDS,
  NEGATION_OR_FUTURE,
  PAY_VERBS,
  VIEW_BALANCE_WORDS,
} from './lexicon.js';

/**
 * RuleProvider: deterministik tahlil (ADR-0004). Shubha bo'lsa UNKNOWN yoki noaniqlik — hech qachon taxmin emas.
 * Natija DB'ga murojaat qilmaydi; mijozni aniqlash (resolver) va qaror (policy) alohida.
 */

export const MAX_INPUT_LENGTH = 1000;
const MAX_NAME_TOKENS = 3;
const MAX_NAME_TOKEN_LENGTH = 30;

export interface RuleResult extends StructuredIntent {
  /** Normalizatsiyalangan matn (log va grounding uchun). */
  readonly normalized: string;
  readonly amountCandidates: readonly AmountCandidate[];
  /** Bir nechta har xil summa topildi (summa tanlanmadi). */
  readonly multiAmount: boolean;
  /**
   * Mijoz nomining foydalanuvchi yozgan KO'RINISHI (Kirill yoki Lotin, bosh harf bilan): yangi mijoz yaratishda
   * ko'rsatiladigan nom. `customer` esa qidiruv uchun normalizatsiyalangan shakl.
   */
  readonly customerDisplay: string | null;
  /** Ism qo'shimchasi: dat (-ga), gen (-ning), ... Yo'nalishni aniqlash uchun. */
  readonly nameSuffix: 'dat' | 'gen' | 'abl' | 'acc' | 'loc' | null;
  /** Bu natija nima uchun UNKNOWN bo'lganini bildiradi (loglar/debug). */
  readonly reason?: string;
}

const SUFFIXES: readonly [string, 'dat' | 'gen' | 'abl' | 'acc' | 'loc'][] = [
  ['ning', 'gen'],
  ['dan', 'abl'],
  ['ga', 'dat'],
  ['ka', 'dat'],
  ['qa', 'dat'],
  ['ni', 'acc'],
  ['da', 'loc'],
];

function stripSuffix(token: string): { stem: string; kind: RuleResult['nameSuffix'] } {
  for (const [suffix, kind] of SUFFIXES) {
    if (token.length - suffix.length >= 2 && token.endsWith(suffix)) {
      return { stem: token.slice(0, -suffix.length), kind };
    }
  }
  return { stem: token, kind: null };
}

const capitalize = (s: string): string => {
  const lower = s.toLocaleLowerCase();
  return lower.charAt(0).toLocaleUpperCase() + lower.slice(1);
};

/**
 * Normalizatsiyalangan ism tokenlariga mos KIRISH tokenlarini topib, foydalanuvchi yozgan ko'rinishni qaytaradi.
 * `suffixLength` — oxirgi tokendan kesilgan qo'shimcha uzunligi (Kirill va Lotin qo'shimchalari bir xil uzunlikda).
 */
function displayFromRaw(raw: string, nameTokens: readonly string[], suffixLength: number): string {
  const rawTokens = raw
    .split(/[\s,:\-–—()"«»]+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}'ʻʼ‘’`]+|[^\p{L}\p{N}'ʻʼ‘’`]+$/gu, ''))
    .filter(Boolean);
  const byNormalized = new Map<string, string>();
  for (const t of rawTokens) {
    const key = normalizeText(t);
    if (!byNormalized.has(key)) byNormalized.set(key, t);
  }
  return nameTokens
    .map((token, i) => {
      let rawToken = byNormalized.get(token) ?? token;
      if (i === nameTokens.length - 1 && suffixLength > 0)
        rawToken = rawToken.slice(0, -suffixLength);
      return capitalize(rawToken);
    })
    .join(' ');
}

const VALID_TOKEN = /^[\p{L}\p{N}']+(?:-[\p{L}\p{N}']+)*$/u;
const HAS_ALNUM = /[\p{L}\p{N}]/u;
const PHONE_RE =
  /(\+?998[ -]?\d{2}[ -]?\d{3}[ -]?\d{2}[ -]?\d{2})(?!\d)|(?<!\d)(\d{2}[ -]\d{3}[ -]\d{2}[ -]\d{2})(?!\d)/;

const unknown = (
  normalized: string,
  reason: string,
  extra: Partial<RuleResult> = {},
): RuleResult => ({
  intent: 'UNKNOWN',
  customer: null,
  customerAlt: null,
  amount: null,
  amountKind: 'NONE',
  fraction: null,
  dateOffsetDays: 0,
  confidence: { intent: 0, customer: 0, amount: 0, date: 1 },
  normalized,
  amountCandidates: [],
  multiAmount: false,
  customerDisplay: null,
  nameSuffix: null,
  reason,
  ...extra,
});

/** Berilgan oraliqlarni bo'shliq bilan almashtiradi (uzunlik saqlanadi). */
function blank(text: string, spans: ReadonlyArray<{ start: number; end: number }>): string {
  const chars = [...text];
  for (const { start, end } of spans)
    for (let i = start; i < end && i < chars.length; i++) chars[i] = ' ';
  return chars.join('');
}

export function parseRules(rawText: string): RuleResult {
  if (typeof rawText !== 'string' || rawText.length > MAX_INPUT_LENGTH) {
    return unknown('', 'too_long');
  }
  const normalized = normalizeText(rawText);
  if (!normalized) return unknown(normalized, 'empty');

  const question = rawText.includes('?');
  const phoneMatch = PHONE_RE.exec(normalized);
  const candidates = extractAmounts(normalized);

  // Qoldiq matn: summa va telefon oraliqlari olib tashlangan
  let residual = maskNonAmounts(normalized);
  residual = blank(residual, candidates);
  if (phoneMatch) {
    residual = blank(residual, [
      { start: phoneMatch.index, end: phoneMatch.index + phoneMatch[0].length },
    ]);
  }

  const clauses = residual.split(/[.!?;\n]+/).filter((c) => HAS_ALNUM.test(c));
  const tokenize = (s: string) =>
    s
      .split(/[\s,:\-–—()"«»]+/)
      .map((t) => t.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, ''))
      .filter((t) => HAS_ALNUM.test(t));
  const allTokens = clauses.flatMap(tokenize);
  const firstClause = tokenize(clauses[0] ?? '');

  if (allTokens.some((t) => !VALID_TOKEN.test(t)))
    return unknown(normalized, 'invalid_chars', { amountCandidates: candidates });

  const forms = (t: string): string[] => {
    const b = bare(t);
    return [b, b.replace(/(.)\1+$/, '$1')]; // "berdii" → "berdi"
  };
  const hasAny = (set: ReadonlySet<string>) =>
    allTokens.some((t) => forms(t).some((f) => set.has(f)));
  const hasWord = (word: string) => allTokens.some((t) => forms(t).includes(word));

  // 1) Xavfsizlik: o'chirish, inkor, kelasi zamon
  if (hasAny(DELETE_WORDS))
    return unknown(normalized, 'delete_words', { amountCandidates: candidates });
  if (hasAny(NEGATION_OR_FUTURE))
    return unknown(normalized, 'negation_or_future', { amountCandidates: candidates });

  // 2) Mijoz yaratish: "yangi mijoz X", "mijoz qo'sh X"
  const bareTokens = allTokens.map(bare);
  const mijozIdx = bareTokens.indexOf('mijoz');
  const isCreateCustomer =
    mijozIdx >= 0 &&
    (bareTokens[mijozIdx - 1] === 'yangi' ||
      ['qosh', 'qoshish', 'yarat'].includes(bareTokens[mijozIdx + 1] ?? ''));

  // 3) Ism tokenlari (birinchi gap bo'lagidan), leksikondagilarsiz
  const isLexical = (t: string): boolean =>
    forms(t).some(
      (f) =>
        PAY_VERBS.has(f) ||
        DEBT_VERBS.has(f) ||
        GIVE_FIRST_PERSON.has(f) ||
        FULL_WORDS.has(f) ||
        FRACTION_HALF.has(f) ||
        FRACTION_QUARTER.has(f) ||
        VIEW_BALANCE_WORDS.has(f) ||
        HISTORY_WORDS.has(f) ||
        FILLERS.has(f) ||
        GREETINGS.has(f),
    );
  const nameTokens = firstClause.filter((t) => !isLexical(t));

  let customer: string | null = null;
  let customerAlt: string | null = null;
  let customerDisplay: string | null = null;
  let nameSuffix: RuleResult['nameSuffix'] = null;
  if (nameTokens.length > 0) {
    if (
      nameTokens.length > MAX_NAME_TOKENS ||
      nameTokens.some((t) => t.length > MAX_NAME_TOKEN_LENGTH) ||
      !nameTokens.some((t) => /\p{L}/u.test(t))
    ) {
      return unknown(normalized, 'invalid_name', { amountCandidates: candidates });
    }
    const last = nameTokens.at(-1)!;
    const { stem, kind } = stripSuffix(last);
    const head = nameTokens.slice(0, -1);
    customer = [...head, stem].join(' ');
    customerAlt = kind ? [...head, last].join(' ') : null;
    nameSuffix = kind;
    customerDisplay = displayFromRaw(rawText, nameTokens, kind ? last.length - stem.length : 0);
  }

  // 4) Summa
  const multiAmount = new Set(candidates.map((c) => c.value)).size > 1;
  const single = singleAmount(candidates);

  // 5) Sana
  const dateOffsetDays = hasWord('kecha') ? -1 : 0;

  // 6) Ko'rish buyruqlari
  const payVerb = hasAny(PAY_VERBS);
  const giveFirst = hasAny(GIVE_FIRST_PERSON);
  const debtVerb = hasAny(DEBT_VERBS);

  if (isCreateCustomer) {
    if (!customer)
      return unknown(normalized, 'customer_name_missing', { amountCandidates: candidates });
    const phone = phoneMatch ? `+998${phoneMatch[0].replace(/\D/g, '').slice(-9)}` : undefined;
    return {
      ...unknown(normalized, ''),
      intent: 'CREATE_CUSTOMER',
      customer,
      customerAlt,
      customerDisplay,
      nameSuffix,
      ...(phone ? { phone } : {}),
      confidence: { intent: 0.95, customer: 0.9, amount: 0, date: 1 },
      reason: undefined,
    } as RuleResult;
  }

  const hasQancha = hasWord('qancha');
  const wantsBalance =
    candidates.length === 0 &&
    !payVerb &&
    !giveFirst &&
    ((hasQancha && (hasWord('qarz') || hasWord('qarzi') || hasWord('qoldi') || hasWord('bor'))) ||
      hasAny(VIEW_BALANCE_WORDS));
  const wantsHistory = candidates.length === 0 && !payVerb && !giveFirst && hasAny(HISTORY_WORDS);
  if ((wantsBalance || wantsHistory) && customer) {
    return {
      ...unknown(normalized, ''),
      intent: wantsHistory ? 'VIEW_CUSTOMER_HISTORY' : 'VIEW_CUSTOMER_BALANCE',
      customer,
      customerAlt,
      customerDisplay,
      nameSuffix,
      confidence: { intent: 0.9, customer: 0.9, amount: 0, date: 1 },
      reason: undefined,
    } as RuleResult;
  }

  // 7) Nasiya / to'lov
  const explicitVerb = payVerb || giveFirst || debtVerb;
  if (!explicitVerb) {
    // Faqat ism ("Murod") — amal emas, mijoz tanlash/menyu uchun
    if (customer && candidates.length === 0) {
      return unknown(normalized, 'bare_name', {
        customer,
        customerAlt,
        customerDisplay,
        nameSuffix,
      });
    }
    if (!customer) return unknown(normalized, 'no_verb_no_name', { amountCandidates: candidates });
  }

  // Fe'llar to'qnashuvi: "berdi" va "yoz" birga — yo'nalish noaniq
  if (payVerb && (debtVerb || giveFirst))
    return unknown(normalized, 'conflicting_verbs', { amountCandidates: candidates });

  let intent: 'CREATE_DEBT' | 'CREATE_PAYMENT';
  if (giveFirst) {
    // "Murodga 50 ming berdim" = men berdim → nasiya. Dativ bo'lmasa yo'nalish noaniq.
    if (nameSuffix !== 'dat')
      return unknown(normalized, 'give_first_without_dative', { amountCandidates: candidates });
    intent = 'CREATE_DEBT';
  } else if (payVerb) {
    // "Murodga 50 ming berdi" — kim kimga berdi noaniq
    if (nameSuffix === 'dat')
      return unknown(normalized, 'ambiguous_direction', { amountCandidates: candidates });
    intent = 'CREATE_PAYMENT';
  } else {
    intent = 'CREATE_DEBT';
  }

  if (!customer && candidates.length === 0) {
    return unknown(normalized, 'no_name_no_amount', { amountCandidates: candidates });
  }
  if (question) return unknown(normalized, 'question', { amountCandidates: candidates });
  if (
    allTokens.some((t) => forms(t).some((f) => f.endsWith('mi') && PAY_VERBS.has(f.slice(0, -2))))
  ) {
    return unknown(normalized, 'question', { amountCandidates: candidates });
  }

  let amountKind: StructuredIntent['amountKind'] = 'NONE';
  let amount: number | null = null;
  let fraction: [number, number] | null = null;
  if (candidates.length > 0) {
    if (single !== null) {
      amount = single;
      amountKind = 'ABSOLUTE';
    }
  } else if (intent === 'CREATE_PAYMENT') {
    if (hasAny(FRACTION_HALF)) {
      amountKind = 'FRACTION';
      fraction = [1, 2];
    } else if (hasAny(FRACTION_QUARTER)) {
      amountKind = 'FRACTION';
      fraction = [1, 4];
    } else if (hasWord('uchdan') && hasWord('birini')) {
      amountKind = 'FRACTION';
      fraction = [1, 3];
    } else if (hasAny(FULL_WORDS)) {
      amountKind = 'FULL';
    }
  }

  return {
    intent,
    customer,
    customerAlt,
    customerDisplay,
    amount,
    amountKind,
    fraction,
    dateOffsetDays,
    confidence: {
      intent: explicitVerb ? 0.95 : 0.75,
      customer: customer ? 0.9 : 0,
      amount:
        amountKind === 'ABSOLUTE' ? 0.95 : multiAmount ? 0.2 : amountKind === 'NONE' ? 0 : 0.8,
      date: 1,
    },
    normalized,
    amountCandidates: candidates,
    multiAmount,
    nameSuffix,
  };
}
