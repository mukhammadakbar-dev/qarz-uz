import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { HistoryGroups } from '../../components/History';
import { Button, ErrorBox, HeroAmount, PageHead, Spinner } from '../../components/ui';
import { useI18n } from '../../lib/i18n';
import { useCore } from '../../state/session';

/** Superadmin: do'kon mijozi va uning tarixi — faqat ko'rish (har ochilish audit'ga yoziladi). */
export function AdminCustomer() {
  const { id = '', customerId = '' } = useParams();
  const { api } = useCore();
  const { t } = useI18n();

  const customer = useQuery({
    queryKey: ['admin', 'customer', id, customerId],
    queryFn: () => api.adminCustomer(id, customerId),
  });
  const history = useInfiniteQuery({
    queryKey: ['admin', 'ledger', id, customerId],
    queryFn: ({ pageParam }) =>
      api.adminLedger(id, customerId, { ...(pageParam ? { cursor: pageParam } : {}), limit: 30 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  if (customer.isPending) return <Spinner />;
  if (customer.error)
    return <ErrorBox error={customer.error} onRetry={() => void customer.refetch()} />;
  const c = customer.data;
  const entries = history.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <div className="page">
        <PageHead />
        <section className="hero">
          <h1 className="customer-name">
            {c.name}
            {c.label ? <span className="muted"> ({c.label})</span> : null}
          </h1>
          {c.phone && <span className="hero-sub">{c.phone}</span>}
          {c.notes && <p className="hero-sub">{c.notes}</p>}
          <span className="label spaced">
            {c.balance > 0 ? t('detail.debt') : t('detail.noDebt')}
          </span>
          <HeroAmount
            value={c.balance}
            className={c.balance > 0 ? 'debt' : 'muted'}
            testId="balance"
          />
          {c.status === 'ARCHIVED' && <p className="hero-sub">{t('detail.archivedNote')}</p>}
        </section>
        <p className="muted small">{t('admin.readOnly')}</p>
      </div>
      <section className="panel" aria-label={t('detail.history')}>
        {history.isPending ? (
          <Spinner />
        ) : history.error ? (
          <div className="page">
            <ErrorBox error={history.error} onRetry={() => void history.refetch()} />
          </div>
        ) : entries.length === 0 ? (
          <div className="empty">{t('detail.noHistory')}</div>
        ) : (
          <HistoryGroups entries={entries} />
        )}
        {history.hasNextPage && (
          <div className="page">
            <Button
              variant="fill"
              busy={history.isFetchingNextPage}
              onClick={() => void history.fetchNextPage()}
            >
              {t('common.more')}
            </Button>
          </div>
        )}
      </section>
    </>
  );
}
