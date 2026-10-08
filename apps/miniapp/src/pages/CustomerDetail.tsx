import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { EntryIcon, HistoryGroups, useTypeLabel } from '../components/History';
import { IconDebt, IconMore, IconPay, IconPhone } from '../components/icons';
import {
  Button,
  ErrorBox,
  HeroAmount,
  PageHead,
  Sheet,
  Spinner,
  Toast,
  useErrorText,
  useToast,
} from '../components/ui';
import { dayLabel, grouped, money, signed, timeOf } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useIdempotencyKey } from '../lib/idempotency';
import { haptic } from '../lib/telegram';
import type { HistoryItem } from '../lib/types';
import { useSession } from '../state/session';
import type { SavedEntry } from './AddEntry';

export function CustomerDetail() {
  const { id = '' } = useParams();
  const { api, locale, role } = useSession();
  const { t } = useI18n();
  const typeLabel = useTypeLabel();
  const location = useLocation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const errorText = useErrorText();
  const { toast, show, hide } = useToast();
  const [selected, setSelected] = useState<HistoryItem | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [menu, setMenu] = useState(false);
  const deleteKey = useIdempotencyKey();
  const undoKey = useIdempotencyKey();

  const customer = useQuery({ queryKey: ['customer', id], queryFn: () => api.customer(id) });
  const history = useInfiniteQuery({
    queryKey: ['ledger', id],
    queryFn: ({ pageParam }) =>
      api.ledger(id, { ...(pageParam ? { cursor: pageParam } : {}), limit: 30 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const refreshAll = () =>
    Promise.all(
      ['customer', 'ledger', 'customers', 'dashboard'].map((k) =>
        client.invalidateQueries({ queryKey: [k] }),
      ),
    );

  const closeSheet = () => {
    setSelected(null);
    setConfirming(false);
    setReason('');
  };

  const remove = useMutation({
    mutationFn: (entry: HistoryItem) =>
      api.deleteEntry(entry.id, reason.trim() || undefined, deleteKey.current()),
    onSuccess: async () => {
      deleteKey.rotate();
      haptic('success');
      closeSheet();
      show(t('entry.delete.done'));
      await refreshAll();
    },
    onError: () => haptic('error'),
  });

  // Hozirgina saqlangan yozuvni bekor qilish (xato bosilgan bo'lsa)
  const undo = useMutation({
    mutationFn: (entryId: string) => api.deleteEntry(entryId, undefined, undoKey.current()),
    onSuccess: async () => {
      undoKey.rotate();
      haptic('success');
      show(t('entry.undone'));
      await refreshAll();
    },
    onError: (error) => show(errorText(error)),
  });

  // AddEntry'dan kelgan "saqlandi" xabari: bir marta ko'rsatiladi (yangilanganda takrorlanmaydi)
  useEffect(() => {
    const saved = (location.state as { saved?: SavedEntry } | null)?.saved;
    if (!saved) return;
    void navigate(location.pathname, { replace: true, state: null });
    show(
      t(saved.type === 'payment' ? 'entry.saved.payment' : 'entry.saved.debt', {
        amount: grouped(saved.amount),
      }),
      {
        label: t('entry.undo'),
        run: () => {
          hide();
          undo.mutate(saved.entryId);
        },
      },
    );
  }, []); // faqat sahifa ochilganda

  const toggleArchive = useMutation({
    mutationFn: () => (customer.data?.status === 'ARCHIVED' ? api.unarchive(id) : api.archive(id)),
    onSuccess: async () => {
      setMenu(false);
      await refreshAll();
    },
  });

  if (customer.isPending) return <Spinner />;
  if (customer.error)
    return <ErrorBox error={customer.error} onRetry={() => void customer.refetch()} />;
  const c = customer.data;
  const archived = c.status === 'ARCHIVED';
  const entries = history.data?.pages.flatMap((p) => p.items) ?? [];
  const deletable = (e: HistoryItem) => !e.isReversal && !e.reversedBy && !archived;

  return (
    <>
      <div className="page">
        <PageHead
          right={
            role === 'OWNER' ? (
              <button
                type="button"
                className="icon-btn"
                aria-label={t('detail.actions')}
                onClick={() => setMenu(true)}
              >
                <IconMore />
              </button>
            ) : undefined
          }
        />
        <section className="hero">
          <h1 className="customer-name">
            {c.name}
            {c.label ? <span className="muted"> ({c.label})</span> : null}
          </h1>
          {c.phone && (
            <a className="phone-link" href={`tel:${c.phone}`}>
              <IconPhone />
              <span>{c.phone}</span>
            </a>
          )}
          {c.notes && <p className="hero-sub">{c.notes}</p>}
          <span className="label spaced">
            {c.balance > 0 ? t('detail.debt') : t('detail.noDebt')}
          </span>
          <HeroAmount
            value={c.balance}
            className={c.balance > 0 ? 'debt' : 'muted'}
            testId="balance"
          />
          {archived && <p className="hero-sub">{t('detail.archivedNote')}</p>}
        </section>

        {!archived && (
          <div className="grid-2 big-actions">
            <Link className="btn btn-debt" to={`/customers/${id}/add/debt`}>
              <IconDebt size={20} />
              {t('detail.addDebt')}
            </Link>
            <Link className="btn btn-ink" to={`/customers/${id}/add/payment`}>
              <IconPay size={20} />
              {t('detail.addPayment')}
            </Link>
          </div>
        )}
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
          <HistoryGroups entries={entries} onSelect={setSelected} />
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

      {selected && (
        <Sheet title={t('entry.details')} onClose={() => !remove.isPending && closeSheet()}>
          <div className="sheet-hero">
            <EntryIcon e={selected} big />
            <span className="muted">
              {typeLabel(selected)}
              {selected.reversedBy ? ` · ${t('entry.deleted')}` : ''}
            </span>
            <span className={`amount ${selected.delta > 0 ? 'debt' : 'pay'}`}>
              {signed(selected.delta)} <span className="unit">{t('common.sum')}</span>
            </span>
          </div>
          <dl className="details">
            <div>
              <dt>{t('entry.field.balance')}</dt>
              <dd>
                {grouped(selected.runningBalance - selected.delta)} →{' '}
                {grouped(selected.runningBalance)}
              </dd>
            </div>
            <div>
              <dt>{t('entry.field.time')}</dt>
              <dd>
                {dayLabel(selected.occurredAt, locale, t)}, {timeOf(selected.occurredAt)}
              </dd>
            </div>
            {selected.createdByName && (
              <div>
                <dt>{t('entry.field.by')}</dt>
                <dd>{selected.createdByName}</dd>
              </div>
            )}
            {selected.description && (
              <div>
                <dt>{t('entry.field.note')}</dt>
                <dd>{selected.description}</dd>
              </div>
            )}
          </dl>

          {deletable(selected) && confirming ? (
            <div className="form">
              <p className="sheet-note">
                {t('entry.delete.body', { amount: money(c.balance - selected.delta, locale) })}
              </p>
              <div className="field">
                <label htmlFor="reason">{t('entry.delete.reason')}</label>
                <input
                  id="reason"
                  className="input"
                  value={reason}
                  maxLength={200}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
              {remove.error && (
                <p className="error-text" role="alert">
                  {errorText(remove.error)}
                </p>
              )}
              <Button
                variant="danger"
                busy={remove.isPending}
                onClick={() => remove.mutate(selected)}
              >
                {t('entry.delete.confirm')}
              </Button>
              <Button
                variant="fill"
                disabled={remove.isPending}
                onClick={() => setConfirming(false)}
              >
                {t('entry.delete.keep')}
              </Button>
            </div>
          ) : deletable(selected) ? (
            <div className="grid-2">
              <Button
                variant="danger-outline"
                aria-label={`${t('common.delete')} ${typeLabel(selected)} ${signed(selected.delta)}`}
                onClick={() => setConfirming(true)}
              >
                {t('common.delete')}
              </Button>
              <Button variant="fill" onClick={closeSheet}>
                {t('common.close')}
              </Button>
            </div>
          ) : (
            <Button variant="fill" onClick={closeSheet}>
              {t('common.close')}
            </Button>
          )}
        </Sheet>
      )}

      {menu && (
        <Sheet title={t('detail.actions')} showTitle onClose={() => setMenu(false)}>
          <div className="menu-list">
            <button
              type="button"
              className="menu-item"
              disabled={(!archived && c.balance !== 0) || toggleArchive.isPending}
              onClick={() => toggleArchive.mutate()}
            >
              {archived ? t('detail.unarchive') : t('detail.archive')}
            </button>
          </div>
          {!archived && c.balance !== 0 && (
            <p className="sheet-note">{t('detail.archiveBlocked')}</p>
          )}
          {toggleArchive.error && <ErrorBox error={toggleArchive.error} />}
        </Sheet>
      )}

      <Toast toast={toast} />
    </>
  );
}
