import { normalizeName } from '@nasiya/shared';
import { ValidationError } from '../../errors/index.js';

const clean = (raw: string): string =>
  raw
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export interface NormalizedText {
  readonly display: string;
  readonly normalized: string;
}

function text(raw: string, field: string, max: number): NormalizedText {
  const display = clean(raw);
  const normalized = normalizeName(display);
  if (display.length < 1 || display.length > max || normalized.length < 1) {
    throw new ValidationError(`${field} yaroqsiz`, { details: { field } });
  }
  return { display, normalized };
}

export const parseCustomerName = (raw: string): NormalizedText => text(raw, 'name', 100);
export const parseCustomerLabel = (raw: string): NormalizedText => text(raw, 'label', 50);

export function parseNotes(raw: string): string {
  // Qator uzilishi (\n) saqlanadi, boshqa boshqaruv/ko'rinmas belgilar bo'shliqqa aylanadi
  const notes = raw
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}]/gu, (ch) => (ch === '\n' ? ch : ' '))
    .trim();
  if (notes.length > 500)
    throw new ValidationError('notes juda uzun', { details: { field: 'notes' } });
  return notes;
}

/**
 * O'zbekiston raqami → +998XXXXXXXXX. Qabul qilinadi: "+998 90 123 45 67", "998901234567",
 * "90 123 45 67", "901234567", "(90) 123-45-67". Boshqa hamma narsa rad etiladi.
 */
export function parsePhone(raw: string): string {
  const digits = raw.replace(/[\s\-()]/g, '').replace(/^\+/, '');
  if (!/^\d+$/.test(digits))
    throw new ValidationError('telefon yaroqsiz', { details: { field: 'phone' } });
  const national = digits.startsWith('998') ? digits.slice(3) : digits;
  if (!/^\d{9}$/.test(national)) {
    throw new ValidationError('telefon yaroqsiz', { details: { field: 'phone' } });
  }
  return `+998${national}`;
}
