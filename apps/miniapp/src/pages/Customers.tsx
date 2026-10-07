import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, ErrorBox, Spinner, useDebounced } from '../components/ui';
import { money } from '../lib/format';
import { useI18n } from '../lib/i18n';
import type { SortKey } from '../lib/types';
import { useSession } from '../state/session';

export function Customers() {
  const { api, locale, role } = useSession();
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('debt');
  const [debtors, setDebtors] = useState(false);
  const [archived, setArchived] = useState(false);
  const search = useDebounced(q.trim(), 300);

  const query = useInfiniteQuery({
    queryKey: ['customers', { search, sort, debtors, archived }],
    queryFn: ({ pageParam }) =>
      api.customers({
        ...(search ? { q: search } : {}),
        sort,
        ...(debtors ? { debtors: true } : {}),
        ...(archived ? { status: 'ARCHIVED' as const } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
        limit: 30,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="stack">
      <input
        className="input"
        type="search"
        placeholder={t('cust.search')}
        aria-label={t('cust.search')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="chips" role="group">
        {(['debt', 'name', 'newest'] as const).map((s) => (
          <button
            key={s}
            className={`chip ${sort === s ? 'chip-on' : ''}`}
            aria-pressed={sort === s}
            onClick={() => setSort(s)}
          >
            {t(`cust.sort.${s}`)}
          </button>
        ))}
        <button
          className={`chip ${debtors ? 'chip-on' : ''}`}
          aria-pressed={debtors}
          onClick={() => setDebtors(!debtors)}
        >
          {t('cust.onlyDebtors')}
        </button>
        {role === 'OWNER' && (
          <button
            className={`chip ${archived ? 'chip-on' : ''}`}
            aria-pressed={archived}
            onClick={() => setArchived(!archived)}
          >
            {t('cust.archived')}
          </button>
        )}
      </div>

      {query.isPending ? (
        <Spinner />
      ) : query.error ? (
        <ErrorBox error={query.error} onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <p className="hint">{t('cust.none')}</p>
      ) : (
        <ul className="list">
          {items.map((c) => (
            <li key={c.id}>
              <Link to={`/customers/${c.id}`} className="row">
                <span className="name">
                  {c.name}
                  {c.label ? <small> ({c.label})</small> : null}
                </span>
                <span className={c.balance > 0 ? 'debt' : 'hint'}>{money(c.balance, locale)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage && (
        <Button
          variant="secondary"
          busy={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {t('cust.more')}
        </Button>
      )}
      <Link className="fab" to="/customers/new">
        {t('cust.new')}
      </Link>
    </div>
  );
}
