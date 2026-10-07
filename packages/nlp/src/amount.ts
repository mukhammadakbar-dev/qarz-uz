/**
 * Summa ajratgich (deterministik). Kirish: `normalizeText` natijasi (Lotin, lowercase).
 *
 * Qo'llab-quvvatlanadi (TT §6, §20, §46):
 *   50 ming | 50ming | 50 000 | 50000 | 50k | 50.000 | 450,000 | 1 200 000 | 1.200.000
 *   1,5 mln | 1.5 mln | 12,5 ming | 3 mln 500 ming | 12 ming 500 | 10 mlrd
 *   yuz ming | ikki yuz ming | o'n besh ming | yarim million | bir million | besh ming
 *   -50 ming (manfiy: rad etish uchun alohida belgilanadi)
 *
 * Ajratgich HECH NARSANI TAXMIN QILMAYDI: noaniq shakl (masalan, o'nli kasr birliksiz "1,5") summa
 * deb olinmaydi. Bir nechta har xil summa bo'lsa chaqiruvchi ularni noaniqlik deb hisoblaydi.
 */

export interface AmountCandidate {
  /** Butun so'm (manfiy bo'lishi mumkin: "-50 ming"). */
  readonly value: number;
  /** Matndagi [start, end) oraliq (normalizatsiyalangan matn bo'yicha). */
  readonly start: number;
  readonly end: number;
  readonly raw: string;
}

const UNIT_VALUES: Readonly<Record<string, number>> = {
  k: 1e3,
  ming: 1e3,
  mln: 1e6,
  million: 1e6,
  milyon: 1e6,
  mlrd: 1e9,
  milliard: 1e9,
  milyard: 1e9,
};

const UNIT_RE = /^(milliard|milyard|million|milyon|mlrd|mln|ming|k)(?![\p{L}])/u;
const CURRENCY_WORDS = new Set(['som', 'sum', "so'm", 'soum']);

const isDigit = (ch: string | undefined): boolean => ch !== undefined && ch >= '0' && ch <= '9';
const isLetter = (ch: string | undefined): boolean => ch !== undefined && /\p{L}/u.test(ch);

/** Telefon va sana ko'rinishidagi bo'laklar summa bo'lmasligi uchun bo'shliq bilan almashtiriladi (uzunlik saqlanadi). */
export function maskNonAmounts(text: string): string {
  const blank = (m: string) => ' '.repeat(m.length);
  return text
    .replace(/\+?998[ -]?\d{2}[ -]?\d{3}[ -]?\d{2}[ -]?\d{2}(?!\d)/g, blank)
    .replace(/\+\d[\d ()-]{6,}\d/g, blank)
    .replace(/(?<!\d)\d{2}[ -]\d{3}[ -]\d{2}[ -]\d{2}(?!\d)/g, blank)
    .replace(/(?<!\d)\d{1,2}[./]\d{1,2}[./]\d{2,4}(?!\d)/g, blank);
}

interface NumberToken {
  /** Butun qism raqamlari ("1200000" yoki "50"), ming guruhlari birlashtirilgan. */
  readonly intDigits: string;
  /** O'nli qism raqamlari yoki ''. */
  readonly fracDigits: string;
  readonly hadGrouping: boolean;
  readonly end: number;
}

/** pos dagi raqamni o'qiydi: ming guruhlari (" 000", ".000", ",000") va o'nli qism. */
function readNumber(text: string, pos: number): NumberToken {
  let i = pos;
  let intDigits = '';
  while (isDigit(text[i])) intDigits += text[i++];

  let hadGrouping = false;
  // Ming guruhlari: ajratgichdan keyin AYNAN 3 raqam va undan keyin raqam emas
  for (;;) {
    const sep = text[i];
    if (sep !== ' ' && sep !== '.' && sep !== ',') break;
    const group = text.slice(i + 1, i + 4);
    if (/^\d{3}$/.test(group) && !isDigit(text[i + 4])) {
      // Birinchi guruh 1-3 raqamdan iborat bo'lishi kerak (aks holda bu "50000 123" kabi alohida son)
      if (!hadGrouping && intDigits.length > 3) break;
      intDigits += group;
      hadGrouping = true;
      i += 4;
      continue;
    }
    break;
  }

  let fracDigits = '';
  if ((text[i] === '.' || text[i] === ',') && isDigit(text[i + 1])) {
    let j = i + 1;
    while (isDigit(text[j])) fracDigits += text[j++];
    i = j;
  }
  return { intDigits, fracDigits, hadGrouping, end: i };
}

/** intDigits.fracDigits * mult ni BUTUN son sifatida qaytaradi; butun bo'lmasa null. */
function scaled(intDigits: string, fracDigits: string, mult: number): number | null {
  const int = Number(intDigits);
  if (!fracDigits) return int * mult;
  const scale = 10 ** fracDigits.length;
  const fractional = (Number(fracDigits) * mult) / scale;
  return Number.isInteger(fractional) ? int * mult + fractional : null;
}

interface Part {
  readonly value: number;
  readonly unit: number; // 1 = birliksiz
}

/** Raqamli ifoda: "50 ming", "3 mln 500 ming", "12 ming 500", "50 000", "1,5 mln". */
function readNumeric(text: string, start: number): { value: number; end: number } | null {
  const parts: Part[] = [];
  let pos = start;
  let end = start;

  for (;;) {
    if (!isDigit(text[pos])) break;
    const num = readNumber(text, pos);
    let unit = 1;
    let after = num.end;

    // Birlik: raqamdan keyin bo'shliqsiz yoki bo'shliq bilan
    let k = after;
    while (text[k] === ' ') k++;
    const unitMatch = UNIT_RE.exec(text.slice(k));
    if (unitMatch) {
      unit = UNIT_VALUES[unitMatch[1]!]!;
      after = k + unitMatch[1]!.length;
    }

    const hasDecimal = num.fracDigits.length > 0;
    if (unit === 1 && hasDecimal) {
      // "1,5" birliksiz: noaniq (o'nli kasrmi, ming guruhimi) — summa deb olinmaydi
      return parts.length > 0 ? finish(parts, end) : null;
    }
    const value = scaled(num.intDigits, num.fracDigits, unit);
    if (value === null) return parts.length > 0 ? finish(parts, end) : null;

    const prev = parts.at(-1);
    if (prev) {
      // Davomi faqat kichikroq birlik bilan: "3 mln 500 ming", yoki "ming" dan keyin <1000: "12 ming 500"
      const ok =
        (unit > 1 && unit < prev.unit) ||
        (unit === 1 && prev.unit === 1e3 && value < 1000 && !num.hadGrouping && !hasDecimal);
      if (!ok) break;
    }
    parts.push({ value, unit });
    end = after;
    pos = after;

    // Keyingi bo'lak faqat birlikli (ming/mln/...) ifodadan keyin mumkin
    if (unit === 1) break;
    let q = pos;
    while (text[q] === ' ') q++;
    if (q === pos || !isDigit(text[q])) break;
    pos = q;
  }
  return parts.length > 0 ? finish(parts, end) : null;
}

const finish = (parts: Part[], end: number) => ({
  value: parts.reduce((sum, p) => sum + p.value, 0),
  end,
});

// ───────── So'z bilan yozilgan sonlar ─────────

const WORD_DIGITS: Readonly<Record<string, number>> = {
  bir: 1,
  ikki: 2,
  uch: 3,
  "to'rt": 4,
  tort: 4,
  besh: 5,
  olti: 6,
  yetti: 7,
  sakkiz: 8,
  "to'qqiz": 9,
  toqqiz: 9,
  "o'n": 10,
  on: 10,
  yigirma: 20,
  "o'ttiz": 30,
  ottiz: 30,
  qirq: 40,
  ellik: 50,
  oltmish: 60,
  yetmish: 70,
  sakson: 80,
  "to'qson": 90,
  toqson: 90,
};
const WORD_UNITS: Readonly<Record<string, number>> = {
  ming: 1e3,
  million: 1e6,
  milyon: 1e6,
  mlrd: 1e9,
  milliard: 1e9,
  milyard: 1e9,
};

interface WordToken {
  readonly word: string;
  readonly start: number;
  readonly end: number;
}

function wordTokens(text: string): WordToken[] {
  return [...text.matchAll(/[\p{L}']+/gu)].map((m) => ({
    word: m[0],
    start: m.index!,
    end: m.index! + m[0].length,
  }));
}

const isNumberWord = (w: string): boolean =>
  w in WORD_DIGITS || w in WORD_UNITS || w === 'yuz' || w === 'yarim';

function evalWordRun(words: string[]): number | null {
  let total = 0;
  let current = 0;
  let half = false;
  let sawBigUnit = false;
  for (const w of words) {
    if (w in WORD_DIGITS) current += WORD_DIGITS[w]!;
    else if (w === 'yuz') current = (current === 0 ? 1 : current) * 100;
    else if (w === 'yarim') half = true;
    else if (w in WORD_UNITS) {
      const unit = WORD_UNITS[w]!;
      const chunk = current === 0 && half ? 0.5 : current === 0 ? 1 : current;
      const v = chunk * unit;
      if (!Number.isInteger(v)) return null;
      total += v;
      current = 0;
      half = false;
      sawBigUnit = true;
    }
  }
  if (half) return null; // "yarim" birliksiz: summa emas (FRACTION iborasi)
  return sawBigUnit || current > 0 ? total + current : null;
}

function readWordAmounts(text: string, taken: ReadonlyArray<[number, number]>): AmountCandidate[] {
  const inTaken = (s: number, e: number) => taken.some(([a, b]) => s < b && e > a);
  const tokens = wordTokens(text).filter((t) => !inTaken(t.start, t.end));
  const out: AmountCandidate[] = [];

  for (let i = 0; i < tokens.length;) {
    if (!isNumberWord(tokens[i]!.word)) {
      i++;
      continue;
    }
    // Ketma-ket (orasida faqat bo'shliq) son so'zlari
    let j = i;
    while (
      j + 1 < tokens.length &&
      isNumberWord(tokens[j + 1]!.word) &&
      /^\s+$/.test(text.slice(tokens[j]!.end, tokens[j + 1]!.start))
    ) {
      j++;
    }
    const run = tokens.slice(i, j + 1);
    const words = run.map((t) => t.word);
    const hasBigUnit = words.some((w) => w in WORD_UNITS);
    // Faqat birlik ("ming") raqamsiz summa emas: kamida bitta son so'zi kerak
    const hasNumberWord = words.some((w) => w in WORD_DIGITS || w === 'yuz' || w === 'yarim');
    if (!hasNumberWord) {
      i = j + 1;
      continue;
    }
    const next = tokens[j + 1];
    const currencyFollows =
      next !== undefined &&
      CURRENCY_WORDS.has(next.word) &&
      /^\s*$/.test(text.slice(run.at(-1)!.end, next.start));
    // "bir", "on" kabi so'zlar oddiy gapda ham uchraydi: birlik (ming/million) yoki pul birligi shart
    if (hasBigUnit || (currencyFollows && words.some((w) => w in WORD_DIGITS || w === 'yuz'))) {
      const value = evalWordRun(words);
      if (value !== null && value > 0) {
        const start = run[0]!.start;
        const end = run.at(-1)!.end;
        out.push({ value, start, end, raw: text.slice(start, end) });
      }
    }
    i = j + 1;
  }
  return out;
}

/** Matndagi barcha summa nomzodlari, joylashuvi bo'yicha tartiblangan. */
export function extractAmounts(text: string): AmountCandidate[] {
  const masked = maskNonAmounts(text);
  const out: AmountCandidate[] = [];

  for (let i = 0; i < masked.length;) {
    if (!isDigit(masked[i])) {
      i++;
      continue;
    }
    const prev = masked[i - 1];
    const attachedToWord = isLetter(prev) || isDigit(prev);
    const result = attachedToWord ? null : readNumeric(masked, i);
    if (!result) {
      // O'qib bo'lmaydigan raqam bo'lagini o'tkazib yuboramiz
      const num = readNumber(masked, i);
      i = Math.max(num.end, i + 1);
      continue;
    }
    // Manfiy: raqamga yopishgan "-" yoki "−", undan oldin bo'shliq yoki matn boshi
    const sign = masked[i - 1];
    const negative = (sign === '-' || sign === '−') && (i - 2 < 0 || /\s/.test(masked[i - 2]!));
    const start = negative ? i - 1 : i;
    out.push({
      value: negative ? -result.value : result.value,
      start,
      end: result.end,
      raw: masked.slice(start, result.end),
    });
    i = result.end;
  }

  out.push(
    ...readWordAmounts(
      masked,
      out.map((c) => [c.start, c.end] as [number, number]),
    ),
  );
  return out.toSorted((a, b) => a.start - b.start);
}

/** Aniq bitta summa bo'lsa — shu; aks holda `null` (yo'q yoki bir nechta har xil). */
export function singleAmount(candidates: readonly AmountCandidate[]): number | null {
  const values = new Set(candidates.map((c) => c.value));
  return values.size === 1 ? [...values][0]! : null;
}
