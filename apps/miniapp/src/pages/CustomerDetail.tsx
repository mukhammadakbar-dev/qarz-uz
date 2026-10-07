import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, Card, ErrorBox, Sheet, Spinner, useErrorText, useToast } from '../components/ui';
import { money, shortDate, signed } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useIdempotencyKey } from '../lib/idempotency';
import { haptic } from '../lib/telegram';
import type { HistoryItem } from '../lib/types';
import { useSession } from '../state/session';

export function CustomerDetail() {
  const { id = '' } = useParams();
  const { api, locale, role } = useSession();
  const { t } = useI18n();
  const client = useQueryClient();
  const navigate = useNavigate();
  const errorText = useErrorText();
  const { toast, show } = useToast();
  const [deleting, setDeleting] = useState<HistoryItem | null>(null);
  const [reason, setReason] = useState('');
  const key = useIdempotencyKey();

  const customer = useQuery({ queryKey: ['customer', id], queryFn: () => api.customer(id) });
  const history = useInfiniteQuery({
    queryKey: ['ledger', id],
    queryFn: ({ pageParam }) =>
      api.ledger(id, { ...(pageParam ? { cursor: pageParam } : {}), limit: 20 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const refreshAll = async () => {
    await Promise.all(
      ['customer', 'ledger', 'customers', 'dashboard'].map((k) =>
        client.invalidateQueries({ queryKey: [k] }),
      ),
    );
  };

  const remove = useMutation({
    mutationFn: (entry: HistoryItem) =>
      api.deleteEntry(entry.id, reason.trim() || undefined, key.current()),
    onSuccess: async () => {
      key.rotate();
      haptic('success');
      setDeleting(null);
      setReason('');
      show(t('entry.delete.done'));
      await refreshAll();
    },
  });

  const toggleArchive = useMutation({
    mutationFn: () => (customer.data?.status === 'ARCHIVED' ? api.unarchive(id) : api.archive(id)),
    onSuccess: refreshAll,
  });

  if (customer.isPending) return <Spinner />;
  if (customer.error)
    return <ErrorBox error={customer.error} onRetry={() => void customer.refetch()} />;
  const c = customer.data;
  const archived = c.status === 'ARCHIVED';
  const entries = history.data?.pages.flatMap((p) => p.items) ?? [];
  const typeLabel = (e: HistoryItem) => (e.isReversal ? t('entry.REVERSAL') : t(`entry.${e.type}`));

  return (
    <div className="stack">
      <Card className="hero">
        <h1>
          {c.name}
          {c.label ? <small> ({c.label})</small> : null}
        </h1>
        <div className="label">{c.balance > 0 ? t('detail.debt') : t('detail.noDebt')}</div>
        <div className={`hero-amount ${c.balance > 0 ? 'debt' : ''}`} data-testid="balance">
          {money(c.balance, locale)}
        </div>
        {c.phone && (
          <a className="phone" href={`tel:${c.phone}`}>
            {c.phone}
          </a>
        )}
        {c.notes && <p className="hint">{c.notes}</p>}
        {archived && <p className="hint">{t('detail.archivedNote')}</p>}
      </Card>

      {!archived && (
        <div className="grid-2">
          <Link className="btn btn-primary" to={`/customers/${id}/add/debt`}>
            {t('detail.addDebt')}
          </Link>
          <Link className="btn btn-secondary" to={`/customers/${id}/add/payment`}>
            {t('detail.addPayment')}
          </Link>
        </div>
      )}

      <h2>{t('detail.history')}</h2>
      {history.isPending ? (
        <Spinner />
      ) : history.error ? (
        <ErrorBox error={history.error} onRetry={() => void history.refetch()} />
      ) : entries.length === 0 ? (
        <p className="hint">{t('detail.noHistory')}</p>
      ) : (
        <ul className="list">
          {entries.map((e) => (
            <li key={e.id} className={`entry ${e.reversedBy ? 'entry-deleted' : ''}`}>
              <div className="entry-main">
                <span className="entry-date">{shortDate(e.occurredAt)}</span>
                <span>
                  {typeLabel(e)}
                  {e.reversedBy ? <small> ({t('entry.deleted')})</small> : null}
                </span>
                <span className={e.delta > 0 ? 'debt' : 'ok'}>{signed(e.delta)}</span>
              </div>
              <div className="entry-sub">
                <span>{t('entry.balance', { amount: money(e.runningBalance, locale) })}</span>
                {e.createdByName && <span>{e.createdByName}</span>}
                {e.description && <span>{e.description}</span>}
                {!e.isReversal && !e.reversedBy && !archived && (
                  <button
                    className="icon-btn"
                    aria-label={`${t('common.delete')} ${typeLabel(e)} ${signed(e.delta)}`}
                    onClick={() => setDeleting(e)}
                  >
                    🗑
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {history.hasNextPage && (
        <Button
          variant="secondary"
          busy={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          {t('cust.more')}
        </Button>
      )}

      {role === 'OWNER' && (
        <div className="stack">
          {toggleArchive.error && <ErrorBox error={toggleArchive.error} />}
          <Button
            variant="ghost"
            busy={toggleArchive.isPending}
            disabled={!archived && c.balance !== 0}
            onClick={() => toggleArchive.mutate()}
          >
            {archived ? t('detail.unarchive') : t('detail.archive')}
          </Button>
          {!archived && c.balance !== 0 && <p className="hint">{t('detail.archiveBlocked')}</p>}
        </div>
      )}

      {deleting && (
        <Sheet
          title={t('entry.delete.title')}
          onClose={() => !remove.isPending && setDeleting(null)}
        >
          <p>
            {t('entry.delete.body', {
              type: typeLabel(deleting),
              amount: money(deleting.amount, locale),
            })}
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
          <div className="grid-2">
            <Button
              variant="secondary"
              disabled={remove.isPending}
              onClick={() => setDeleting(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              busy={remove.isPending}
              onClick={() => remove.mutate(deleting)}
            >
              {t('common.delete')}
            </Button>
          </div>
        </Sheet>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      <button className="link-back" onClick={() => void navigate('/customers')}>
        ← {t('nav.customers')}
      </button>
    </div>
  );
}
