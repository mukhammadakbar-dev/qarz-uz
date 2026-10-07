import { LARGE_AMOUNT_UZS, MAX_AMOUNT_UZS } from '@nasiya/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AmountInput } from '../components/AmountInput';
import { Button, ErrorBox, Sheet, Spinner, useErrorText } from '../components/ui';
import { money } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useIdempotencyKey } from '../lib/idempotency';
import { haptic } from '../lib/telegram';
import type { Preview } from '../lib/types';
import { useSession } from '../state/session';

/**
 * Nasiya / to'lov qo'shish. Server oldindan hisob-kitob (preview) beradi va yakuniy qarorni o'zi qabul qiladi;
 * mijoz tomonidagi tekshiruvlar faqat qulaylik uchun. "Saqlash" bir niyat = bir Idempotency-Key.
 */
export function AddEntry() {
  const { id = '', kind } = useParams();
  const type: 'debt' | 'payment' = kind === 'payment' ? 'payment' : 'debt';
  const { api, locale } = useSession();
  const { t } = useI18n();
  const navigate = useNavigate();
  const client = useQueryClient();
  const errorText = useErrorText();
  const key = useIdempotencyKey();

  const [amount, setAmount] = useState(0);
  const [description, setDescription] = useState('');
  const [offset, setOffset] = useState<0 | -1>(0);
  const [preview, setPreview] = useState<Preview | null>(null);

  const customer = useQuery({ queryKey: ['customer', id], queryFn: () => api.customer(id) });

  const edit =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      key.rotate(); // niyat o'zgardi — yangi kalit
      setPreview(null);
      setter(v);
    };

  const previewMutation = useMutation({
    mutationFn: () => api.preview(id, type, amount),
    onSuccess: setPreview,
  });

  const save = useMutation({
    mutationFn: () =>
      api.addEntry(
        id,
        type,
        {
          amount,
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(offset ? { dateOffsetDays: offset } : {}),
        },
        key.current(),
      ),
    onSuccess: async () => {
      key.rotate();
      haptic('success');
      await Promise.all(
        ['customer', 'ledger', 'customers', 'dashboard'].map((k) =>
          client.invalidateQueries({ queryKey: [k] }),
        ),
      );
      void navigate(`/customers/${id}`, { replace: true });
    },
    onError: () => haptic('error'),
  });

  if (customer.isPending) return <Spinner />;
  if (customer.error)
    return <ErrorBox error={customer.error} onRetry={() => void customer.refetch()} />;
  const balance = customer.data.balance;

  const over = type === 'payment' && amount > balance;
  const noDebt = type === 'payment' && balance === 0;
  const valid = amount >= 1 && amount <= MAX_AMOUNT_UZS && !over && !noDebt;

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) previewMutation.mutate();
      }}
    >
      <h1>{t(type === 'debt' ? 'add.debt.title' : 'add.payment.title')}</h1>
      <p className="hint">
        {customer.data.name}
        {customer.data.label ? ` (${customer.data.label})` : ''} · {t('detail.debt')}:{' '}
        {money(balance, locale)}
      </p>

      <AmountInput value={amount} onChange={edit(setAmount)} label={t('add.amount')} autoFocus />
      {type === 'payment' && balance > 0 && (
        <div className="chips">
          <button type="button" className="chip" onClick={() => edit(setAmount)(balance)}>
            {t('add.all', { amount: money(balance, locale) })}
          </button>
        </div>
      )}
      {over && (
        <p className="error-text" role="alert">
          {t('add.overpay')} {t('add.max', { amount: money(balance, locale) })}
        </p>
      )}
      {noDebt && (
        <p className="error-text" role="alert">
          {t('add.noDebt')}
        </p>
      )}

      <div className="field">
        <label htmlFor="description">{t('add.description')}</label>
        <input
          id="description"
          className="input"
          value={description}
          maxLength={200}
          onChange={(e) => edit(setDescription)(e.target.value)}
        />
      </div>
      <div className="field">
        <span id="date-label">{t('add.date')}</span>
        <div className="chips" role="group" aria-labelledby="date-label">
          <button
            type="button"
            className={`chip ${offset === 0 ? 'chip-on' : ''}`}
            aria-pressed={offset === 0}
            onClick={() => edit(setOffset)(0)}
          >
            {t('add.today')}
          </button>
          <button
            type="button"
            className={`chip ${offset === -1 ? 'chip-on' : ''}`}
            aria-pressed={offset === -1}
            onClick={() => edit(setOffset)(-1)}
          >
            {t('add.yesterday')}
          </button>
        </div>
      </div>

      {previewMutation.error && <ErrorBox error={previewMutation.error} />}
      <Button type="submit" busy={previewMutation.isPending} disabled={!valid}>
        {t('common.continue')}
      </Button>

      {preview && (
        <Sheet title={t('add.confirm.title')} onClose={() => !save.isPending && setPreview(null)}>
          <dl className="summary">
            <dt>{t(type === 'debt' ? 'add.debt.title' : 'add.payment.title')}</dt>
            <dd className={type === 'debt' ? 'debt' : 'ok'}>
              {type === 'debt' ? '+' : '−'}
              {money(amount, locale)}
            </dd>
            <dt>{t('add.confirm.before')}</dt>
            <dd>{money(preview.balance, locale)}</dd>
            <dt>{t('add.confirm.after')}</dt>
            <dd data-testid="balance-after">
              {preview.balanceAfter === null ? '—' : money(preview.balanceAfter, locale)}
            </dd>
          </dl>
          {amount >= LARGE_AMOUNT_UZS && <p className="banner banner-warn">{t('add.largeWarn')}</p>}
          {!preview.allowed && (
            <p className="error-text" role="alert">
              {t('add.overpay')}
            </p>
          )}
          {save.error && (
            <p className="error-text" role="alert">
              {errorText(save.error)}
            </p>
          )}
          <div className="grid-2">
            <Button
              type="button"
              variant="secondary"
              disabled={save.isPending}
              onClick={() => setPreview(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              busy={save.isPending}
              disabled={!preview.allowed}
              onClick={() => save.mutate()}
            >
              {t('common.save')}
            </Button>
          </div>
        </Sheet>
      )}
    </form>
  );
}
