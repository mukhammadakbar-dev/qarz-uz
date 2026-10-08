import { LARGE_AMOUNT_UZS, MAX_AMOUNT_UZS } from '@nasiya/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { IconBackspace, IconClose } from '../components/icons';
import { useGoBack } from '../components/Layout';
import { Avatar, Button, ErrorBox, Spinner, useErrorText } from '../components/ui';
import { grouped, money } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useIdempotencyKey } from '../lib/idempotency';
import { haptic } from '../lib/telegram';
import { useSession } from '../state/session';

export type EntryType = 'debt' | 'payment';

/** Saqlangandan keyin mijoz sahifasiga uzatiladi ("Qaytarish" uchun). */
export interface SavedEntry {
  readonly entryId: string;
  readonly type: EntryType;
  readonly amount: number;
}

const QUICK: Record<EntryType, readonly number[]> = {
  debt: [50_000, 100_000, 200_000, 500_000],
  payment: [50_000, 100_000],
};
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0'] as const;

/**
 * Qarz / to'lov kiritish. Natija darhol ko'rinadi ("Qoldiq: 850 000 → 600 000"), alohida tasdiq oynasi yo'q:
 * xato yozuv mijoz sahifasidagi "Qaytarish" bilan bekor qilinadi. Katta summa ikki bosishni talab qiladi.
 * Server yakuniy qarorni o'zi qabul qiladi; bu yerdagi tekshiruvlar faqat qulaylik uchun.
 * Bir niyat = bir Idempotency-Key (tarmoq xatosidan keyin qayta bosish o'sha kalit bilan).
 */
export function AddEntry() {
  const { id = '', kind } = useParams();
  const { api, locale } = useSession();
  const { t } = useI18n();
  const navigate = useNavigate();
  const goBack = useGoBack();
  const client = useQueryClient();
  const errorText = useErrorText();
  const { current: currentKey, rotate: rotateKey } = useIdempotencyKey();

  const [type, setType] = useState<EntryType>(kind === 'payment' ? 'payment' : 'debt');
  const [digits, setDigits] = useState('');
  const [description, setDescription] = useState('');
  const [offset, setOffset] = useState<0 | -1>(0);
  const [confirmLarge, setConfirmLarge] = useState(false);
  const amount = Number(digits || '0');

  const customer = useQuery({ queryKey: ['customer', id], queryFn: () => api.customer(id) });

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
        currentKey(),
      ),
    onSuccess: async (result) => {
      rotateKey();
      haptic('success');
      await Promise.all(
        ['customer', 'ledger', 'customers', 'dashboard'].map((k) =>
          client.invalidateQueries({ queryKey: [k] }),
        ),
      );
      const saved: SavedEntry = { entryId: result.entry.id, type, amount };
      void navigate(`/customers/${id}`, { replace: true, state: { saved } });
    },
    onError: () => haptic('error'),
  });

  /** Niyat o'zgardi: yangi kalit, eski xato va katta summa tasdig'i bekor. */
  const { reset } = save;
  const change = useCallback(
    (apply: () => void) => {
      rotateKey();
      setConfirmLarge(false);
      reset();
      apply();
    },
    [rotateKey, reset],
  );
  const press = useCallback(
    (d: string) =>
      change(() =>
        setDigits((prev) => {
          const next = (prev + d).replace(/^0+/, '');
          return next.length <= 11 && Number(next || '0') <= MAX_AMOUNT_UZS ? next : prev;
        }),
      ),
    [change],
  );
  const backspace = useCallback(() => change(() => setDigits((p) => p.slice(0, -1))), [change]);

  const balance = customer.data?.balance ?? 0;
  const archived = customer.data?.status === 'ARCHIVED';
  const isPay = type === 'payment';
  const noDebt = isPay && balance === 0;
  const over = isPay && amount > balance;
  const valid = amount >= 1 && amount <= MAX_AMOUNT_UZS && !over && !noDebt && !archived;

  const submit = useCallback(() => {
    if (!valid || save.isPending) return;
    if (amount >= LARGE_AMOUNT_UZS && !confirmLarge) {
      setConfirmLarge(true);
      haptic('light');
      return;
    }
    save.mutate();
  }, [valid, save, amount, confirmLarge]);

  // Kompyuterda klaviatura bilan ham: raqamlar, Backspace, Enter (izoh maydonida emas)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') backspace();
      else if (e.key === 'Enter') submit();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press, backspace, submit]);

  if (customer.isPending) return <Spinner />;
  if (customer.error)
    return <ErrorBox error={customer.error} onRetry={() => void customer.refetch()} />;
  const c = customer.data;

  let hint = t('add.enter');
  let hintClass = '';
  let hintIsError = false;
  if (archived) {
    [hint, hintIsError] = [t('detail.archivedNote'), true];
  } else if (noDebt) {
    [hint, hintIsError] = [t('add.noDebt'), true];
  } else if (over) {
    [hint, hintIsError] = [t('add.overpay', { max: money(balance, locale) }), true];
  } else if (save.error) {
    [hint, hintIsError] = [errorText(save.error), true];
  } else if (confirmLarge) {
    [hint, hintClass] = [t('add.large'), 'is-debt'];
  } else if (amount > 0) {
    hint = t('add.after', {
      before: grouped(balance),
      after: grouped(isPay ? balance - amount : balance + amount),
    });
    hintClass = isPay ? 'is-pay' : 'is-debt';
  }

  const chips = QUICK[type].map((v) => ({ label: grouped(v), value: v }));
  if (isPay && balance > 0)
    chips.push({ label: t('add.all', { amount: grouped(balance) }), value: balance });

  return (
    <div className="entry-screen">
      <div className="entry-top">
        <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={goBack}>
          <IconClose />
        </button>
        <div className="segmented" role="group" aria-label={t('add.type')}>
          {(['debt', 'payment'] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={type === k}
              onClick={() => type !== k && change(() => setType(k))}
            >
              {t(k === 'debt' ? 'add.debt' : 'add.payment')}
            </button>
          ))}
        </div>
        <span className="spacer-44" />
      </div>

      <Link to={`/pick/${type}`} replace className="customer-chip">
        <Avatar name={c.name} small />
        <span className="who">
          <strong>
            {c.name}
            {c.label ? ` (${c.label})` : ''}
          </strong>
          <span>{t('add.currentDebt', { amount: money(balance, locale) })}</span>
        </span>
        <span className="change">{t('add.change')}</span>
      </Link>

      <div className="amount-area">
        <output
          className={`amount-display ${amount ? '' : 'is-empty'}`}
          aria-label={t('add.amount')}
          data-testid="amount"
        >
          <span className="value">{grouped(amount)}</span>
          <span className="unit">{t('common.sum')}</span>
        </output>
        <p
          className={`amount-hint ${hintIsError ? 'is-error' : hintClass}`}
          role={hintIsError ? 'alert' : undefined}
          aria-live="polite"
        >
          {hint}
        </p>
      </div>

      <div className="chips chips-center quick">
        {chips.map((chip) => (
          <button
            key={chip.label}
            type="button"
            className="chip"
            onClick={() => change(() => setDigits(String(chip.value)))}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="note-row">
        <input
          className="input"
          aria-label={t('add.note')}
          placeholder={t('add.note')}
          value={description}
          maxLength={200}
          onChange={(e) => change(() => setDescription(e.target.value))}
        />
        <button
          type="button"
          className="date-toggle"
          aria-label={t('add.date')}
          aria-pressed={offset === -1}
          onClick={() => change(() => setOffset(offset === 0 ? -1 : 0))}
        >
          {t(offset === 0 ? 'add.today' : 'add.yesterday')}
        </button>
      </div>

      <div className="keypad">
        {KEYS.map((k) => (
          <button key={k} type="button" className="key" onClick={() => press(k)}>
            {k}
          </button>
        ))}
        <button type="button" className="key" aria-label={t('add.backspace')} onClick={backspace}>
          <IconBackspace />
        </button>
      </div>

      <div className="save-bar">
        <Button
          block
          variant={isPay ? 'pay' : 'debt-solid'}
          busy={save.isPending}
          disabled={!valid}
          onClick={submit}
        >
          {!valid
            ? t('common.save')
            : confirmLarge
              ? t('add.confirmLarge', { amount: money(amount, locale) })
              : t(isPay ? 'add.savePayment' : 'add.saveDebt', { amount: grouped(amount) })}
        </Button>
      </div>
    </div>
  );
}
