import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { IconSearch } from '../../components/icons';
import { Avatar, Button, ErrorBox, Spinner, useDebounced } from '../../components/ui';
import { grouped, money } from '../../lib/format';
import { useI18n, type MessageKey } from '../../lib/i18n';
import type { AdminBusiness, AdminFilter, AdminStats } from '../../lib/types';
import { useCore } from '../../state/session';

const FILTERS: readonly (AdminFilter | 'all')[] = [
  'all',
  'TRIAL',
  'ACTIVE',
  'EXPIRED',
  'SUSPENDED',
];

const STAT_KEYS: readonly [keyof AdminStats, MessageKey, 'money'?][] = [
  ['businesses', 'admin.stats.businesses'],
  ['trial', 'admin.stats.trial'],
  ['active', 'admin.stats.active'],
  ['expired', 'admin.stats.expired'],
  ['expiringSoon', 'admin.stats.expiringSoon'],
  ['suspended', 'admin.stats.suspended'],
  ['newThisWeek', 'admin.stats.newThisWeek'],
  ['users', 'admin.stats.users'],
  ['customers', 'admin.stats.customers'],
  ['entriesToday', 'admin.stats.entriesToday'],
  ['totalDebt', 'admin.stats.totalDebt', 'money'],
  ['revenueThisMonth', 'admin.stats.revenue', 'money'],
];

/** Obuna holati yorlig'i: "Sinov · 9 kun", "Bloklangan" va h.k. */
export function StateBadge({ b }: { b: Pick<AdminBusiness, 'subscription' | 'suspendedAt'> }) {
  const { t } = useI18n();
  if (b.suspendedAt) return <span className="badge is-expired">{t('admin.filter.SUSPENDED')}</span>;
  const s = b.subscription;
  return (
    <span className={`badge ${s.state === 'EXPIRED' ? 'is-expired' : ''}`}>
      {t(`admin.filter.${s.state}`)}
      {s.state === 'EXPIRED' ? '' : ` · ${t('sub.days', { days: s.daysLeft })}`}
    </span>
  );
}

export function AdminHome() {
  const { api, locale } = useCore();
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<AdminFilter | 'all'>('all');
  const search = useDebounced(q.trim(), 300);

  const stats = useQuery({ queryKey: ['admin', 'stats'], queryFn: () => api.adminStats() });
  const shops = useInfiniteQuery({
    queryKey: ['admin', 'shops', { search, filter }],
    queryFn: ({ pageParam }) =>
      api.adminBusinesses({
        ...(search ? { q: search } : {}),
        ...(filter !== 'all' ? { filter } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
        limit: 30,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = shops.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="page">
      <h1 className="customer-name">{t('admin.title')}</h1>

      {stats.error ? (
        <ErrorBox error={stats.error} onRetry={() => void stats.refetch()} />
      ) : !stats.data ? (
        <Spinner />
      ) : (
        <dl className="stat-grid">
          {STAT_KEYS.map(([key, label, kind]) => (
            <div key={key} className="stat">
              <dt>{t(label)}</dt>
              <dd>
                {kind === 'money' ? money(stats.data[key], locale) : grouped(stats.data[key])}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <Link className="btn btn-ink" to="/admin/broadcast">
        {t('admin.broadcast')}
      </Link>

      <h2 className="section-title">{t('admin.shops')}</h2>
      <label className="search">
        <IconSearch />
        <input
          type="search"
          aria-label={t('admin.search')}
          placeholder={t('admin.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      <div className="chips" role="group" aria-label={t('home.filters')}>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className="chip"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {t(f === 'all' ? 'admin.filter.all' : `admin.filter.${f}`)}
          </button>
        ))}
      </div>

      {shops.isPending ? (
        <Spinner />
      ) : shops.error ? (
        <ErrorBox error={shops.error} onRetry={() => void shops.refetch()} />
      ) : items.length === 0 ? (
        <div className="empty">{t('admin.noShops')}</div>
      ) : (
        <ul className="rows">
          {items.map((b) => (
            <li key={b.id}>
              <Link to={`/admin/shops/${b.id}`} className="row">
                <Avatar name={b.name} />
                <div className="row-body">
                  <div className="row-top">
                    <span className="row-title">
                      {b.name} <small>{b.shortCode}</small>
                    </span>
                    <StateBadge b={b} />
                  </div>
                  <span className="row-sub">
                    {t('admin.shopLine', {
                      owner: b.owner.username ? `@${b.owner.username}` : b.owner.name,
                      customers: b.customers,
                      debt: money(b.totalDebt, locale),
                    })}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {shops.hasNextPage && (
        <Button
          variant="fill"
          busy={shops.isFetchingNextPage}
          onClick={() => void shops.fetchNextPage()}
        >
          {t('common.more')}
        </Button>
      )}
    </div>
  );
}
