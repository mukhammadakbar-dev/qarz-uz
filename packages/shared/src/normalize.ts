/**
 * Yagona normalizatsiya (ADR-0004 §2): interpreter, resolver, qidiruv va `customers.normalized_name`
 * uchun BIR XIL funksiya. Kirill → Lotin (o'zbek kirill alifbosi), apostrof variantlari birlashtiriladi.
 * Lotin matndagi Kirill "homoglif"lari (Мurod, Murоd) ham shu orqali tuzaladi.
 */

const TRANSLIT: Readonly<Record<string, string>> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'j',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'x',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: "'",
  ы: 'i',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  ў: "o'",
  қ: 'q',
  ғ: "g'",
  ҳ: 'h',
};

const APOSTROPHES = /[ʻʼʽʾʿ‘’‛`´′ʹ]/g;
const CYRILLIC = /[а-яёўқғҳ]/g;
const LETTER = /\p{L}/u;

/**
 * Lowercase, Kirill → Lotin, apostrof variantlari → `'`, so'z chetidagi apostrof olib tashlanadi,
 * ketma-ket bo'shliqlar bitta. Tinish belgilari va raqamlar SAQLANADI (summa tahlili uchun kerak).
 */
export function normalizeText(input: string): string {
  const lower = input.normalize('NFC').toLowerCase().replace(APOSTROPHES, "'");

  let out = '';
  let prev = ' ';
  for (const ch of lower) {
    if (CYRILLIC.test(ch)) {
      CYRILLIC.lastIndex = 0;
      // So'z boshidagi "е" = "ye" (Елена → yelena), boshqa joyda "e"
      out += ch === 'е' && !LETTER.test(prev) && prev !== "'" ? 'ye' : (TRANSLIT[ch] ?? ch);
    } else {
      CYRILLIC.lastIndex = 0;
      out += ch;
    }
    prev = ch;
  }

  return out
    .replace(/(?<![\p{L}])'+|'+(?![\p{L}])/gu, '') // so'z chetidagi apostrof (qo'shtirnoq o'rnida ishlatilgani)
    .replace(/'{2,}/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Mijoz nomi/yorlig'i uchun: harf, raqam, apostrof, defis va bo'shliqdan boshqasi bo'shliqqa aylanadi. */
export function normalizeName(input: string): string {
  return normalizeText(input)
    .replace(/[^\p{L}\p{N}' -]+/gu, ' ')
    .replace(/(?<![\p{L}])'+|'+(?![\p{L}])/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
