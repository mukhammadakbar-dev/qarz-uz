/** Format an amount with thin spaces + so'm suffix. */
export const som = (n) => {
  const v = Number(n || 0).toLocaleString('ru-RU').replace(/\u00A0/g, ' ').replace(/,/g, ' ');
  return `${v} so'm`;
};

/** Plain grouped number, no suffix. */
export const grp = (n) =>
  Number(n || 0).toLocaleString('ru-RU').replace(/\u00A0/g, ' ').replace(/,/g, ' ');

/** ISO date -> DD.MM.YYYY */
export const fmtDate = (d) => {
  if (!d) return '—';
  const date = new Date(d);
  if (isNaN(date)) return String(d);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(date.getDate())}.${p(date.getMonth() + 1)}.${date.getFullYear()}`;
};

export const todayISO = () => new Date().toISOString().slice(0, 10);

/**
 * Turn the API's signed `days_left` into the badge shown in the debtors list.
 *
 * The backend computes the number (negative = overdue, 0 = due today) so the
 * browser does no date arithmetic and the badge can never disagree with the row
 * order, which is sorted on the same figure.
 *
 * Returns null when there is no deadline at all — the caller renders a dash.
 */
export const dueLabel = (daysLeft) => {
  if (daysLeft === null || daysLeft === undefined || daysLeft === '') return null;
  const n = Number(daysLeft);
  if (Number.isNaN(n)) return null;

  if (n < 0) return { text: `${Math.abs(n)} kun kechikdi`, cls: 'due-over' };
  if (n === 0) return { text: 'Bugun', cls: 'due-today' };
  // Three days is about as far ahead as a shop owner acts on; past that it is
  // information rather than a task, so it stops competing for attention.
  if (n <= 3) return { text: `${n} kun qoldi`, cls: 'due-soon' };
  return { text: `${n} kun qoldi`, cls: 'due-far' };
};

export const statusMeta = {
  open: { label: 'Ochiq', cls: 'badge-neutral' },
  partial: { label: 'Qisman', cls: 'badge-warn' },
  overdue: { label: 'Muddati o\'tgan', cls: 'badge-danger' },
  paid: { label: 'To\'langan', cls: 'badge-ok' },
};

/**
 * Live formatting for amount inputs: keeps only digits and groups them with
 * spaces, so typing "4500000" shows "4 500 000".
 */
export const formatInputAmount = (raw) => {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return grp(Number(digits));
};

/** Inverse of formatInputAmount: the clean number to send to the backend. */
export const parseInputAmount = (formatted) => {
  const digits = String(formatted ?? '').replace(/\D/g, '');
  return digits ? Number(digits) : NaN;
};

/**
 * Recompute the caret position after reformatting, so typing in the middle of
 * a number doesn't jump the cursor to the end.
 * Counts digits before the caret, then walks the formatted string to find the
 * matching offset.
 */
export const caretAfterFormat = (rawValue, caretPos, formatted) => {
  const digitsBefore = String(rawValue).slice(0, caretPos).replace(/\D/g, '').length;
  if (digitsBefore === 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted[i])) {
      seen++;
      if (seen === digitsBefore) return i + 1;
    }
  }
  return formatted.length;
};
