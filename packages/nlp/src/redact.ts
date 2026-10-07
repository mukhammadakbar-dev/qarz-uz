/**
 * LLM'ga yuborishdan va jurnalga yozishdan oldin shaxsiy ma'lumotni olib tashlaydi (ADR-0004 §6).
 * Ism va SUMMA saqlanadi. Muhim: summalar (900 000, 1.200.000, 900000000) telefon deb tanilmasligi shart.
 */

const PHONE_PATTERNS: readonly RegExp[] = [
  /\(?\+?998\)?[ -]?\(?\d{2}\)?[ -]?\d{3}[ -]?\d{2}[ -]?\d{2}(?!\d)/g, // +998 90 123 45 67
  /(?<![\d.,])\d{2}[ -]\d{3}[ -]\d{2}[ -]\d{2}(?![\d])/g, // 90 123 45 67 (guruhli)
  /\+\d[\d ()-]{6,}\d/g, // boshqa xalqaro raqamlar
];

function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function redactPii(text: string): string {
  let out = text
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '<EMAIL>')
    .replace(/(?:https?:\/\/|www\.)\S+/gi, '<URL>');
  // Karta: 13-19 raqam (4 tadan guruhlangan bo'lishi mumkin) va Luhn tekshiruvi
  out = out.replace(/(?<![\d.,])(?:\d[ -]?){12,18}\d(?![\d])/g, (m) => {
    const digits = m.replace(/\D/g, '');
    return digits.length >= 13 && digits.length <= 19 && luhn(digits) ? '<CARD>' : m;
  });
  for (const pattern of PHONE_PATTERNS) out = out.replace(pattern, '<PHONE>');
  return out;
}
