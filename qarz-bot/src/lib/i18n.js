import uz from '../locales/uz.js';
import ru from '../locales/ru.js';
import { config } from './config.js';

const dict = { uz, ru };

/**
 * Translate a key with {placeholder} interpolation.
 * t('debt_created', 'uz', { name: 'Ali', amount: '50 000', due: '—' })
 */
export const t = (key, lang = config.defaultLang, vars = {}) => {
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
