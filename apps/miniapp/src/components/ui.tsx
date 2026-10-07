import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ApiError } from '../lib/api';
import { useI18n, type MessageKey } from '../lib/i18n';
import { money } from '../lib/format';

export function Centered({ children }: { children: ReactNode }) {
  return <div className="centered">{children}</div>;
}

export function Spinner() {
  const { t } = useI18n();
  return (
    <div className="spinner" role="status" aria-live="polite">
      {t('common.loading')}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function Button({
  variant = 'primary',
  busy,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  busy?: boolean;
}) {
  return (
    <button
      {...rest}
      className={`btn btn-${variant} ${rest.className ?? ''}`}
      disabled={rest.disabled || busy}
    >
      {busy ? '…' : children}
    </button>
  );
}

/** Pastdan chiqadigan oyna (tasdiqlash uchun). */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label={t('common.close')} onClick={onClose}>
            ✕
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

/** API/tarmoq xatosini foydalanuvchi tilidagi matnga aylantiradi. */
export function useErrorText(): (error: unknown) => string {
  const { t, locale } = useI18n();
  return (error) => {
    if (error instanceof ApiError) {
      const key = `err.${error.code}` as MessageKey;
      const max = error.details['maxPayable'];
      if (error.code === 'OVERPAYMENT' && typeof max === 'number')
        return t('err.OVERPAYMENT', { max: money(max, locale) });
      if (error.reason === 'IN_PROGRESS') return t('err.IN_PROGRESS');
      if (error.reason === 'REVERSAL_WOULD_OVERDRAW') return t('entry.delete.blocked');
      if (error.reason === 'LABEL_REQUIRED') return t('new.labelRequired');
      if (error.reason === 'DUPLICATE_IDENTITY') return t('new.duplicate');
      if (error.reason === 'BALANCE_NOT_ZERO') return t('detail.archiveBlocked');
      try {
        return t(key);
      } catch {
        return t('error.generic');
      }
    }
    if (error instanceof TypeError) return t('error.network'); // fetch tarmoq xatosi
    return t('error.generic');
  };
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useI18n();
  const text = useErrorText()(error);
  return (
    <div className="error-box" role="alert">
      <p>{text}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}

/** Qisqa vaqt ko'rinadigan xabar. */
export function useToast(): { toast: string | null; show: (text: string) => void } {
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(id);
  }, [toast]);
  return { toast, show: setToast };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
