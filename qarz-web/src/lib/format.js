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

export const statusMeta = {
  open: { label: 'Ochiq', cls: 'badge-neutral' },
  partial: { label: 'Qisman', cls: 'badge-warn' },
  overdue: { label: 'Muddati o\'tgan', cls: 'badge-danger' },
  paid: { label: 'To\'langan', cls: 'badge-ok' },
};
