import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card, ErrorBox, Spinner } from '../components/ui';
import { money } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useSession } from '../state/session';

export function Dashboard() {
  const { api, locale } = useSession();
  const { t } = useI18n();
  const dash = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.dashboard(),
    staleTime: 30_000,
  });
  const top = useQuery({
    queryKey: ['customers', 'top'],
    queryFn: () => api.customers({ sort: 'debt', debtors: true, limit: 5 }),
    staleTime: 30_000,
  });

  if (dash.isPending) return <Spinner />;
  if (dash.error) return <ErrorBox error={dash.error} onRetry={() => void dash.refetch()} />;
  const { summary } = dash.data;

  return (
    <div className="stack">
      <Card className="hero">
        <div className="label">{t('dash.totalDebt')}</div>
        <div className="hero-amount" data-testid="total-debt">
          {money(summary.totalDebt, locale)}
        </div>
      </Card>
      <div className="grid-2">
        <Card>
          <div className="label">{t('dash.debtors')}</div>
          <div className="stat">{t('dash.count', { n: summary.debtorsCount })}</div>
        </Card>
        <Card>
          <div className="label">{t('dash.today')}</div>
          <div className="stat">{t('dash.count', { n: summary.todayOperations })}</div>
        </Card>
      </div>

      <h2>{t('dash.top')}</h2>
      {top.isPending ? (
        <Spinner />
      ) : top.error ? (
        <ErrorBox error={top.error} onRetry={() => void top.refetch()} />
      ) : top.data.items.length === 0 ? (
        <p className="hint">{t('dash.empty')}</p>
      ) : (
        <ul className="list">
          {top.data.items.map((c) => (
            <li key={c.id}>
              <Link to={`/customers/${c.id}`} className="row">
                <span className="name">
                  {c.name}
                  {c.label ? <small> ({c.label})</small> : null}
                </span>
                <span className="debt">{money(c.balance, locale)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link className="btn btn-secondary" to="/customers">
        {t('dash.all')}
      </Link>
    </div>
  );
}
