import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CustomerRow } from '../components/CustomerRow';
import { IconPlus, IconSearch } from '../components/icons';
import { Button, ErrorBox, PageHead, Spinner, useDebounced } from '../components/ui';
import { useI18n } from '../lib/i18n';
import { useSession } from '../state/session';

/**
 * Yozuv uchun mijoz tanlash: oxirgi faol mijozlar birinchi. To'lovda faqat qarzdorlar.
 * Tanlangach yozuv ekraniga o'tiladi (tarixda bu sahifa qolmaydi — "Orqaga" daftarga qaytaradi).
 */
export function PickCustomer() {
  const { kind } = useParams();
  const type: 'debt' | 'payment' = kind === 'payment' ? 'payment' : 'debt';
  const { api } = useSession();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim(), 300);

  const list = useInfiniteQuery({
    queryKey: ['customers', 'pick', { search, type }],
    queryFn: ({ pageParam }) =>
      api.customers({
        ...(search ? { q: search } : {}),
        sort: 'recent',
        ...(type === 'payment' ? { debtors: true } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
        limit: 30,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const createNew = () =>
    void navigate(
      `/customers/new?then=${type}${search ? `&name=${encodeURIComponent(search)}` : ''}`,
      { replace: true },
    );

  return (
    <div className="page">
      <PageHead title={t(type === 'payment' ? 'pick.payment' : 'pick.debt')} />
      <label className="search">
        <IconSearch />
        <input
          type="search"
          aria-label={t('home.search')}
          placeholder={t('home.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
      </label>

      {type === 'debt' && (
        <Button variant="dashed" onClick={createNew}>
          <IconPlus size={18} />
          {search ? t('home.addNamed', { q: search }) : t('pick.newCustomer')}
        </Button>
      )}

      {list.isPending ? (
        <Spinner />
      ) : list.error ? (
        <ErrorBox error={list.error} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <div className="empty">
          {search
            ? t('home.notFound', { q: search })
            : t(type === 'payment' ? 'pick.noDebtors' : 'home.empty')}
        </div>
      ) : (
        <ul className="rows">
          {items.map((c) => (
            <CustomerRow key={c.id} customer={c} to={`/customers/${c.id}/add/${type}`} replace />
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
    </div>
  );
}
