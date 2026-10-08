import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { grouped, initials, money } from '../lib/format';
import { useI18n, type MessageKey } from '../lib/i18n';
import { IconBack } from './icons';

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

type Variant =
  'ink' | 'fill' | 'debt' | 'pay' | 'debt-solid' | 'danger' | 'danger-outline' | 'dashed' | 'text';

export function Button({
  variant = 'ink',
  busy,
  block,
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  busy?: boolean;
  block?: boolean;
}) {
  return (
    <button
      type="button"
      {...rest}
      className={`btn btn-${variant} ${block ? 'btn-block' : ''} ${className}`}
      disabled={rest.disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy ? '…' : children}
    </button>
  );
}

/** Sahifa sarlavhasi: orqaga, nom, o'ng tomonda ixtiyoriy amal. */
export function PageHead({
  title,
  back,
  right,
}: {
  title?: string;
  back?: string | (() => void);
  right?: ReactNode;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const goBack = () => {
    if (typeof back === 'function') back();
    else if (typeof back === 'string') void navigate(back);
    // Chuqur havola bilan ochilgan bo'lsa tarix yo'q: bosh sahifaga
    else if (location.key === 'default') void navigate('/', { replace: true });
    else void navigate(-1);
  };
  return (
    <header className="page-head">
      <button type="button" className="icon-btn" aria-label={t('common.back')} onClick={goBack}>
        <IconBack />
      </button>
      {title ? <h1>{title}</h1> : <span />}
      {right ?? <span className="spacer-44" />}
    </header>
  );
}

export function Avatar({ name, small }: { name: string; small?: boolean }) {
  return (
    <div className={`avatar ${small ? 'avatar-sm' : ''}`} aria-hidden="true">
      {initials(name)}
    </div>
  );
}

/** Katta summa: "12 480 000" + kichik "so‘m". */
export function HeroAmount({
  value,
  className = '',
  testId,
}: {
  value: number;
  className?: string;
  testId?: string;
}) {
  const { t, locale } = useI18n();
  return (
    <div
      className={`hero-amount ${className}`}
      data-testid={testId}
      aria-label={money(value, locale)}
    >
      <span aria-hidden="true">{grouped(value)}</span>
      <span className="unit" aria-hidden="true">
        {t('common.sum')}
      </span>
    </div>
  );
}

/** Pastdan chiqadigan oyna. Fon yoki Escape yopadi. */
export function Sheet({
  title,
  showTitle = false,
  onClose,
  children,
}: {
  title: string;
  showTitle?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
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
        <div className="sheet-handle" />
        {showTitle && <h2 className="sheet-title">{title}</h2>}
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
      if (error.reason === 'SUSPENDED') return t('err.SUSPENDED');
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
        <Button variant="fill" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}

export interface ToastState {
  readonly text: string;
  readonly action?: { readonly label: string; readonly run: () => void };
}

/** Qisqa xabar; amal (masalan, "Qaytarish") bo'lsa uzoqroq turadi. */
export function useToast(): {
  toast: ToastState | null;
  show: (text: string, action?: ToastState['action']) => void;
  hide: () => void;
} {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hide = useCallback(() => setToast(null), []);
  const show = useCallback((text: string, action?: ToastState['action']) => {
    setToast(action ? { text, action } : { text });
  }, []);
  useEffect(() => {
    if (!toast) return;
    timer.current = setTimeout(() => setToast(null), toast.action ? 8000 : 2500);
    return () => clearTimeout(timer.current);
  }, [toast]);
  return { toast, show, hide };
}

export function Toast({ toast, aboveTabbar }: { toast: ToastState | null; aboveTabbar?: boolean }) {
  if (!toast) return null;
  return (
    <div className={`toast ${aboveTabbar ? 'above-tabbar' : ''}`} role="status">
      <span>{toast.text}</span>
      {toast.action && (
        <button type="button" onClick={toast.action.run}>
          {toast.action.label}
        </button>
      )}
    </div>
  );
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
