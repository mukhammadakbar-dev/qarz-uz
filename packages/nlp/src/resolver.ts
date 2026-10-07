/**
 * Mijozni aniqlash (ADR-0004 §10). Deterministik, DB'siz: nomzodlar ro'yxati beriladi.
 * Prinsip (TT §12): noto'g'ri mijoz tanlash eng xavfli xato → shubha bo'lsa SAVOL.
 */

export interface CustomerRef {
  readonly id: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly label: string | null;
  readonly normalizedLabel: string | null;
  readonly balance: number;
}

export type Resolution =
  | { readonly kind: 'resolved'; readonly customer: CustomerRef }
  | {
      readonly kind: 'ambiguous';
      readonly candidates: readonly CustomerRef[];
      /** Aniq (to'liq) mos kelganlar soni; mijoz yaratishda "shu ism bor" belgisi uchun. */
      readonly exactCount: number;
    }
  | { readonly kind: 'none' };

/** Ko'rsatish uchun: "Murod (aka)". */
export const displayName = (c: Pick<CustomerRef, 'name' | 'label'>): string =>
  c.label ? `${c.name} (${c.label})` : c.name;

const MIN_FUZZY_LENGTH = 5;

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1); // almashtirish
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  return shorter.slice(i) === longer.slice(i + 1); // qo'shish/olib tashlash
}

interface Matches {
  exact: CustomerRef[];
  near: CustomerRef[];
}

function match(variant: string, customers: readonly CustomerRef[]): Matches {
  const exact: CustomerRef[] = [];
  const near: CustomerRef[] = [];
  let matchedByLabel = false;
  for (const c of customers) {
    const full = c.normalizedLabel ? `${c.normalizedName} ${c.normalizedLabel}` : null;
    if (c.normalizedName === variant || full === variant) {
      exact.push(c);
      if (full === variant) matchedByLabel = true;
    } else if (
      c.normalizedName.startsWith(variant) ||
      variant.startsWith(c.normalizedName) ||
      (variant.length >= MIN_FUZZY_LENGTH &&
        c.normalizedName.length >= MIN_FUZZY_LENGTH &&
        editDistanceAtMostOne(variant, c.normalizedName))
    ) {
      near.push(c);
    }
  }
  // Yorliq aniq aytilgan ("murod aka"): shu ismli boshqa yorliqdagi mijozlar nomzod emas
  if (matchedByLabel) {
    const names = new Set(exact.map((c) => c.normalizedName));
    return { exact, near: near.filter((c) => !names.has(c.normalizedName)) };
  }
  return { exact, near };
}

const CANDIDATE_LIMIT = 8;

/**
 * @param mention  interpreter ajratgan ism (qo'shimchasiz, normalizatsiyalangan)
 * @param alt      qo'shimchasi kesilmagan shakl (ixtiyoriy)
 * @param customers  FAOL mijozlar (arxivdagilar chiqarib tashlangan)
 */
export function resolveCustomer(
  mention: string,
  alt: string | null | undefined,
  customers: readonly CustomerRef[],
): Resolution {
  const variants = [mention, ...(alt && alt !== mention ? [alt] : [])];
  const matches = variants.map((variant) => match(variant, customers));

  // 1) Aniq va yagona moslik (qaysi shakl bo'lsa ham): masalan "ol" topilmasa-yu, "olga" aniq topilsa
  for (const { exact, near } of matches) {
    if (exact.length === 1 && near.length === 0) return { kind: 'resolved', customer: exact[0]! };
  }
  // 2) Moslik bor, lekin noaniq: savol
  for (const { exact, near } of matches) {
    if (exact.length + near.length > 0) {
      return {
        kind: 'ambiguous',
        candidates: [...exact, ...near].slice(0, CANDIDATE_LIMIT),
        exactCount: exact.length,
      };
    }
  }

  // Oxirgi urinish: noma'lum so'z ismga yopishib qolgan bo'lishi mumkin ("murod ber" → "murod").
  // Bunday mos kelish HECH QACHON avtomatik tanlanmaydi — foydalanuvchi tasdiqlaydi.
  const tokens = mention.split(' ');
  for (let n = tokens.length - 1; n >= 1; n--) {
    const { exact, near } = match(tokens.slice(0, n).join(' '), customers);
    if (exact.length + near.length > 0) {
      return {
        kind: 'ambiguous',
        candidates: [...exact, ...near].slice(0, CANDIDATE_LIMIT),
        exactCount: 0,
      };
    }
  }
  return { kind: 'none' };
}
