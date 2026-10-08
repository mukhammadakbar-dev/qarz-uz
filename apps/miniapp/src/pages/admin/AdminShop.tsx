import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { CustomerRow } from '../../components/CustomerRow';
import { IconSearch } from '../../components/icons';
import {
  Avatar,
  Button,
  ErrorBox,
  PageHead,
  Sheet,
  Spinner,
  Toast,
  useDebounced,
  useErrorText,
  useToast,
} from '../../components/ui';
import { fullDate, grouped, money, parseDigits } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { useIdempotencyKey } from '../../lib/idempotency';
import { openLink } from '../../lib/telegram';
import type { AdminBusinessDetail } from '../../lib/types';
import { useCore } from '../../state/session';
import { StateBadge } from './AdminHome';

const MONTHS = [1, 3, 6, 12] as const;

export function AdminShop() {
  const { id = '' } = useParams();
  const { api } = useCore();
  const { t } = useI18n();
  const { toast, show } = useToast();
  const [extending, setExtending] = useState(false);
  const [suspending, setSuspending] = useState(false);

  const shop = useQuery({ queryKey: ['admin', 'shop', id], queryFn: () => api.adminBusiness(id) });

  if (shop.isPending) return <Spinner />;
  if (shop.error) return <ErrorBox error={shop.error} onRetry={() => void shop.refetch()} />;
  const b = shop.data;

  return (
    <div className="page">
      <PageHead title={b.name} />
      <p className="muted small">{t('admin.readOnly')}</p>

      <section className="card" aria-label={t('admin.owner')}>
        <dl className="details">
          <div>
            <dt>{t('admin.code')}</dt>
            <dd>{b.shortCode}</dd>
          </div>
          <div>
            <dt>{t('admin.owner')}</dt>
            <dd>
              {b.owner.name}
              {b.owner.username ? ` (@${b.owner.username})` : ''}
              <br />
              <small className="muted">ID {b.owner.telegramUserId}</small>
            </dd>
          </div>
          <div>
            <dt>{t('admin.created')}</dt>
            <dd>{fullDate(b.createdAt)}</dd>
          </div>
          <div>
            <dt>{t('admin.lastEntry')}</dt>
            <dd>{b.lastEntryAt ? fullDate(b.lastEntryAt) : t('admin.never')}</dd>
          </div>
          <div>
            <dt>{t('admin.stats.customers')}</dt>
            <dd>{grouped(b.customers)}</dd>
          </div>
          <div>
            <dt>{t('admin.entries')}</dt>
            <dd>{grouped(b.entries)}</dd>
          </div>
        </dl>
        {b.owner.username && (
          <Button variant="fill" onClick={() => openLink(`https://t.me/${b.owner.username}`)}>
            {t('admin.openChat')}
          </Button>
        )}
      </section>

      <section className="card" aria-label={t('sub.title')}>
        <div className="card-head">
          <span>{t('sub.title')}</span>
          <StateBadge b={b} />
        </div>
        {b.subscription.state !== 'EXPIRED' && (
          <p className="muted">{t('sub.until', { date: fullDate(b.subscription.until) })}</p>
        )}
        {b.suspendedAt && (
          <p className="error-text">
            {t('admin.suspendedSince', { date: fullDate(b.suspendedAt) })}
            {b.suspendedReason ? ` — ${b.suspendedReason}` : ''}
          </p>
        )}
        <div className="grid-2">
          <Button onClick={() => setExtending(true)}>{t('admin.extend')}</Button>
          {b.suspendedAt ? (
            <UnsuspendButton id={id} onDone={() => show(t('admin.unsuspended'))} />
          ) : (
            <Button variant="danger-outline" onClick={() => setSuspending(true)}>
              {t('admin.suspend')}
            </Button>
          )}
        </div>
      </section>

      <section className="card" aria-label={t('admin.members')}>
        <div className="card-head">
          <span>{t('admin.members')}</span>
          <span className="muted">{b.members.length}</span>
        </div>
        <ul className="plain-list">
          {b.members.map((m) => (
            <li
              key={m.userId}
              className={`staff-row ${m.status === 'REVOKED' ? 'is-revoked' : ''}`}
            >
              <Avatar name={m.name} small />
              <div className="who">
                <strong>
                  {m.name}
                  {m.username ? ` @${m.username}` : ''}
                </strong>
                <span>
                  {t('staff.since', { role: t(`role.${m.role}`), date: fullDate(m.joinedAt) })}
                  {m.status === 'REVOKED' ? ` · ${t('staff.revoked')}` : ''}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card" aria-label={t('admin.payments')}>
        <div className="card-head">
          <span>{t('admin.payments')}</span>
        </div>
        {b.payments.length === 0 ? (
          <p className="muted">{t('admin.noPayments')}</p>
        ) : (
          <ul className="plain-list">
            {b.payments.map((p) => (
              <li key={p.id} className="staff-row">
                <div className="who">
                  <strong>
                    {fullDate(p.periodFrom)} → {fullDate(p.periodTo)}
                  </strong>
                  <span>
                    {t('admin.payment', {
                      amount: grouped(p.amount),
                      months: p.months,
                      by: p.recordedBy,
                    })}
                    {p.note ? ` · ${p.note}` : ''}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ShopCustomers id={id} />

      {extending && (
        <ExtendSheet
          shop={b}
          onClose={() => setExtending(false)}
          onDone={(until) => {
            setExtending(false);
            show(t('admin.extend.done', { date: fullDate(until) }));
          }}
        />
      )}
      {suspending && (
        <SuspendSheet
          id={id}
          onClose={() => setSuspending(false)}
          onDone={() => setSuspending(false)}
        />
      )}
      <Toast toast={toast} />
    </div>
  );
}

function useRefreshAdmin() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ['admin'] });
}

function ExtendSheet({
  shop,
  onClose,
  onDone,
}: {
  shop: AdminBusinessDetail;
  onClose: () => void;
  onDone: (until: string) => void;
}) {
  const { api, locale } = useCore();
  const { t } = useI18n();
  const errorText = useErrorText();
  const refresh = useRefreshAdmin();
  const key = useIdempotencyKey();
  const [months, setMonths] = useState<number>(1);
  const [amount, setAmount] = useState(shop.priceUzs);
  const [note, setNote] = useState('');
  const extend = useMutation({
    mutationFn: () =>
      api.adminExtend(
        shop.id,
        { months, amount, ...(note.trim() ? { note: note.trim() } : {}) },
        key.current(),
      ),
    onSuccess: async (r) => {
      key.rotate();
      await refresh();
      onDone(r.paidUntil);
    },
  });
  const change = (apply: () => void) => {
    key.rotate();
    extend.reset();
    apply();
  };

  return (
    <Sheet title={t('admin.extend')} showTitle onClose={() => !extend.isPending && onClose()}>
      <div className="field">
        <span className="label">{t('admin.extend.months')}</span>
        <div className="chips" role="group" aria-label={t('admin.extend.months')}>
          {MONTHS.map((m) => (
            <button
              key={m}
              type="button"
              className="chip"
              aria-pressed={months === m}
              onClick={() =>
                change(() => {
                  setMonths(m);
                  setAmount(shop.priceUzs * m);
                })
              }
            >
              {t('admin.extend.monthsN', { n: m })}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="ext-amount">{t('admin.extend.amount')}</label>
        <input
          id="ext-amount"
          className="input"
          inputMode="numeric"
          value={amount ? grouped(amount) : ''}
          onChange={(e) => change(() => setAmount(parseDigits(e.target.value)))}
        />
      </div>
      <div className="field">
        <label htmlFor="ext-note">{t('admin.extend.note')}</label>
        <input
          id="ext-note"
          className="input"
          maxLength={300}
          value={note}
          onChange={(e) => change(() => setNote(e.target.value))}
        />
      </div>
      {extend.error && (
        <p className="error-text" role="alert">
          {errorText(extend.error)}
        </p>
      )}
      <Button busy={extend.isPending} disabled={amount < 1} onClick={() => extend.mutate()}>
        {t('admin.extend.confirm', { n: months })} · {money(amount, locale)}
      </Button>
    </Sheet>
  );
}

function SuspendSheet({
  id,
  onClose,
  onDone,
}: {
  id: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { api } = useCore();
  const { t } = useI18n();
  const errorText = useErrorText();
  const refresh = useRefreshAdmin();
  const [reason, setReason] = useState('');
  const suspend = useMutation({
    mutationFn: () => api.adminSuspend(id, reason.trim() || undefined),
    onSuccess: async () => {
      await refresh();
      onDone();
    },
  });
  return (
    <Sheet
      title={t('admin.suspend.title')}
      showTitle
      onClose={() => !suspend.isPending && onClose()}
    >
      <p className="sheet-note">{t('admin.suspend.body')}</p>
      <div className="field">
        <label htmlFor="sus-reason">{t('admin.suspend.reason')}</label>
        <input
          id="sus-reason"
          className="input"
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      {suspend.error && (
        <p className="error-text" role="alert">
          {errorText(suspend.error)}
        </p>
      )}
      <Button variant="danger" busy={suspend.isPending} onClick={() => suspend.mutate()}>
        {t('admin.suspend')}
      </Button>
      <Button variant="fill" disabled={suspend.isPending} onClick={onClose}>
        {t('common.cancel')}
      </Button>
    </Sheet>
  );
}

function UnsuspendButton({ id, onDone }: { id: string; onDone: () => void }) {
  const { api } = useCore();
  const { t } = useI18n();
  const refresh = useRefreshAdmin();
  const unsuspend = useMutation({
    mutationFn: () => api.adminUnsuspend(id),
    onSuccess: async () => {
      await refresh();
      onDone();
    },
  });
  return (
    <Button variant="fill" busy={unsuspend.isPending} onClick={() => unsuspend.mutate()}>
      {t('admin.unsuspend')}
    </Button>
  );
}

function ShopCustomers({ id }: { id: string }) {
  const { api } = useCore();
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim(), 300);
  const list = useInfiniteQuery({
    queryKey: ['admin', 'shop-customers', id, search],
    queryFn: ({ pageParam }) =>
      api.adminCustomers(id, {
        ...(search ? { q: search } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
        limit: 30,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section aria-label={t('admin.customers')} className="form">
      <h2 className="section-title">{t('admin.customers')}</h2>
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
      {list.isPending ? (
        <Spinner />
      ) : list.error ? (
        <ErrorBox error={list.error} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <div className="empty">{search ? t('home.notFound', { q: search }) : t('home.empty')}</div>
      ) : (
        <ul className="rows">
          {items.map((c) => (
            <CustomerRow key={c.id} customer={c} to={`/admin/shops/${id}/customers/${c.id}`} />
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
    </section>
  );
}
