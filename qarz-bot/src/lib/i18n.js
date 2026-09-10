import uz from '../locales/uz.js';
import ru from '../locales/ru.js';
import { config } from './config.js';

const dict = { uz, ru };

/**
 * Escape the three characters Telegram's HTML parser treats as markup.
 *
 * Nearly every message this bot sends goes out with parse_mode: 'HTML', and the
 * templates carry real tags (<b>, <code>, <i>). The VALUES substituted into them
 * are user input — a shop name, a person's name — and were dropped in raw. A
 * shop called "A&B" or "Diyor <Market>" produced a message Telegram refuses to
 * parse, so the API returned 400 and the user simply never received it: the
 * registration confirmation, the debtors list, whatever it was, silently
 * missing with nothing to explain it.
 *
 * Debtor names happen to be safe today because debtor.controller.js validates
 * them against a letters-only regex, but shop and user names are plain strings —
 * and relying on a validator two services away to keep this rendering correct is
 * exactly how it broke.
 *
 * Escaping in plain text is lossless: Telegram renders &amp; back as "&", so a
 * URL containing &  survives intact.
 */
const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Translate a key with {placeholder} interpolation.
 * t('debt_created', 'uz', { name: 'Ali', amount: '50 000', due: '—' })
 *
 * Interpolated values are HTML-escaped; the template itself is not, so its own
 * tags keep working.
 */
export const t = (key, lang = config.defaultLang, vars = {}) => {
  const table = dict[lang] || dict.uz;
  let str = table[key] ?? dict.uz[key] ?? key;
  for (const [k, v] of Object.entries(vars)) {
    str = str.replaceAll(`{${k}}`, escapeHtml(String(v)));
  }
  return str;
};

/**
 * Same as `t`, without escaping — for text Telegram does NOT parse as HTML.
 *
 * Button labels are the case that matters: an inline keyboard caption is plain
 * text, so a customer called "A&B" would read as "A&amp;B" on the button if it
 * went through the escaping path.
 */
export const tPlain = (key, lang = config.defaultLang, vars = {}) => {
  const table = dict[lang] || dict.uz;
  let str = table[key] ?? dict.uz[key] ?? key;
  for (const [k, v] of Object.entries(vars)) {
    str = str.replaceAll(`{${k}}`, String(v));
  }
  return str;
};

/** Format an integer amount with spaces: 50000 -> "50 000" */
export const money = (n) =>
  Number(n || 0)
    .toLocaleString('ru-RU')
    .replace(/,/g, ' ')
    .replace(/\u00A0/g, ' '); // normalize non-breaking spaces
