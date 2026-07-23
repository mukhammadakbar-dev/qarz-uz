/**
 * Normalize Uzbek phone numbers to +998XXXXXXXXX form.
 * Accepts: 998901234567, +998901234567, 901234567, 90 123 45 67, etc.
 */
export const normalizePhone = (input) => {
  if (!input) return null;
  let digits = String(input).replace(/[^\d]/g, '');
  if (digits.startsWith('998')) {
    // already has country code
  } else if (digits.length === 9) {
    digits = '998' + digits;
  } else if (digits.startsWith('8') && digits.length === 10) {
    digits = '998' + digits.slice(1);
  }
  if (digits.length !== 12) return null; // 998 + 9 digits
  return '+' + digits;
};
