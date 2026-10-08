import { Link } from 'react-router-dom';
import { ago, daysAgo, grouped } from '../lib/format';
import { useI18n } from '../lib/i18n';
import type { Customer } from '../lib/types';
import { Avatar } from './ui';

/** Shu kundan eski qarz ko'zga tashlanadi (qarz rangi bilan). */
export const OLD_DEBT_DAYS = 21;

export function CustomerRow({
  customer: c,
  to,
  replace,
}: {
  customer: Customer;
  to: string;
  replace?: boolean;
}) {
  const { t } = useI18n();
  const days = daysAgo(c.lastActivityAt);
  const old = c.balance > 0 && days >= OLD_DEBT_DAYS;
  return (
    <li>
      <Link to={to} replace={replace} className="row">
        <Avatar name={c.name} />
        <div className="row-body">
          <div className="row-top">
            <span className="row-title">
              {c.name}
              {c.label ? <small> ({c.label})</small> : null}
            </span>
            <span className={`row-amount ${c.balance > 0 ? 'debt' : 'muted'}`}>
              {grouped(c.balance)}
            </span>
          </div>
          <span className={`row-sub ${old ? 'debt' : ''}`}>{ago(days, t)}</span>
        </div>
      </Link>
    </li>
  );
}
