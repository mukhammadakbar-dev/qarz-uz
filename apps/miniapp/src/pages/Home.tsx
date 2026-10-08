import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CustomerRow } from '../components/CustomerRow';
import { IconCheck, IconChevronDown, IconPlus, IconSearch } from '../components/icons';
import { Button, ErrorBox, HeroAmount, Sheet, Spinner, useDebounced } from '../components/ui';
import { useI18n } from '../lib/i18n';
import { useSession } from '../state/session';

type Filter = 'debtors' | 'all' | 'archived';

/**
 * Daftar: jami qarz, qidiruv va mijozlar ro'yxati bitta ekranda. Asosiy amal — "Yozuv" (mijoz tanlab qarz/to'lov).
 * Qidiruv "Qarzdorlar" filtrida ham hamma mijozni topadi (qarzi yo'q mijozga ham nasiya yozish uchun).
 */
export function Home() {
  const { api, me, businessId, role, switchBusiness } = useSession();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('debtors');
  const [switching, setSwitching] = useState(false);
  const search = useDebounced(q.trim(), 300);

  const dash = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.dashboard(),
    staleTime: 30_000,
  });
  const list = useInfiniteQuery({
    queryKey: ['customers', { search, filter }],
    queryFn: ({ pageParam }) =>
      api.customers({
        ...(search ? { q: search } : {}),
        sort: filter === 'debtors' ? 'debt' : 'recent',
        ...(filter === 'debtors' && !search ? { debtors: true } : {}),
        ...(filter === 'archived' ? { status: 'ARCHIVED' as const } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
        limit: 30,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const businessName =
    dash.data?.business.name ?? me.businesses.find((b) => b.id === businessId)?.name ?? '';
  const filters: Filter[] = role === 'OWNER' ? ['debtors', 'all', 'archived'] : ['debtors', 'all'];

  const empty = () => {
    if (search)
      return (
        <div className="empty">
          <strong>{t('home.notFound', { q: search })}</strong>
          {filter !== 'archived' && (
            <Button
              variant="fill"
              onClick={() => void navigate(`/customers/new?name=${encodeURIComponent(search)}`)}
            >
              <IconPlus size={18} />
              {t('home.addNamed', { q: search })}
            </Button>
          )}
        </div>
      );
    if (filter === 'archived') return <div className="empty">{t('home.noArchived')}</div>;
    if (filter === 'debtors') return <div className="empty">{t('home.noDebtors')}</div>;
    return (
      <div className="empty">
        <strong>{t('home.empty')}</strong>
        <span>{t('home.emptyHint')}</span>
      </div>
    );
  };

  return (
    <div className="page">
      <div>
        {me.businesses.length > 1 ? (
          <button
            type="button"
            className="biz-switch"
            aria-label={`${t('home.switchBusiness')}: ${businessName}`}
            onClick={() => setSwitching(true)}
          >
            <span>{businessName}</span>
            <IconChevronDown />
          </button>
        ) : (
          <div className="biz-switch">
            <span>{businessName}</span>
          </div>
        )}
        {role === 'STAFF' && <span className="role-tag">{t('role.STAFF')}</span>}
      </div>

      {dash.error ? (
        <ErrorBox error={dash.error} onRetry={() => void dash.refetch()} />
      ) : dash.data ? (
        <section className="hero">
          <span className="label">{t('home.totalDebt')}</span>
          <HeroAmount value={dash.data.summary.totalDebt} testId="total-debt" />
          <span className="hero-sub">
            {t('home.sub', {
              n: dash.data.summary.debtorsCount,
              ops: dash.data.summary.todayOperations,
            })}
          </span>
        </section>
      ) : (
        <Spinner />
      )}

      <label className="search">
        <IconSearch />
        <input
          type="search"
          aria-label={t('home.search')}
          placeholder={t('home.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>

      <div className="chips" role="group" aria-label={t('home.filters')}>
        {filters.map((f) => (
          <button
            key={f}
            type="button"
            className="chip"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {t(`home.filter.${f}`)}
          </button>
        ))}
      </div>

      {list.isPending ? (
        <Spinner />
      ) : list.error ? (
        <ErrorBox error={list.error} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        empty()
      ) : (
        <ul className="rows">
          {items.map((c) => (
            <CustomerRow key={c.id} customer={c} to={`/customers/${c.id}`} />
          ))}
        </ul>
      )}
      {list.hasNextPage && (
        <Button
          variant="fill"
          busy={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {t('common.more')}
        </Button>
      )}

      <Link className="fab" to="/pick/debt" aria-label={t('home.fabLabel')}>
        <IconPlus />
        <span>{t('home.fab')}</span>
      </Link>

      {switching && (
        <Sheet title={t('home.switchBusiness')} showTitle onClose={() => setSwitching(false)}>
          <div className="menu-list">
            {me.businesses.map((b) => (
              <button
                key={b.id}
                type="button"
                className="menu-item"
                aria-current={b.id === businessId || undefined}
                onClick={() => {
                  setSwitching(false);
                  if (b.id !== businessId) void switchBusiness(b.id);
                }}
              >
                <span>
                  {b.name} <small className="muted">· {t(`role.${b.role}`)}</small>
                </span>
                {b.id === businessId && <IconCheck size={20} />}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}
