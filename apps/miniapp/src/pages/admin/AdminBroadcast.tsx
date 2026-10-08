import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
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
import { fullDate, timeOf } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { useIdempotencyKey } from '../../lib/idempotency';
import type { SegmentState } from '../../lib/types';
import { useCore } from '../../state/session';

const SEGMENTS: readonly SegmentState[] = ['TRIAL', 'ACTIVE', 'EXPIRED'];
const MAX = 4000;

/**
 * Ommaviy xabar: matn, guruhlar (obuna holati), xodimlar ham. Yuborishdan oldin aniq son ko'rsatiladi va
 * tasdiq so'raladi; bir bosish = bir Idempotency-Key (ikki marta bosilsa ham bitta broadcast).
 */
export function AdminBroadcast() {
  const { api } = useCore();
  const { t } = useI18n();
  const client = useQueryClient();
  const errorText = useErrorText();
  const { toast, show } = useToast();
  const key = useIdempotencyKey();
  const [text, setText] = useState('');
  const [segments, setSegments] = useState<SegmentState[]>(['TRIAL', 'ACTIVE', 'EXPIRED']);
  const [includeStaff, setIncludeStaff] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const selected = useMemo(() => ({ segments, includeStaff }), [segments, includeStaff]);
  const audience = useDebounced(selected, 250);

  const preview = useQuery({
    queryKey: ['admin', 'bc-preview', audience],
    queryFn: () => api.adminBroadcastPreview(audience),
    enabled: audience.segments.length > 0,
  });
  const history = useQuery({
    queryKey: ['admin', 'broadcasts'],
    queryFn: () => api.adminBroadcasts(),
    // Yuborilayotgan bo'lsa natija yangilanib turadi
    refetchInterval: (q) =>
      q.state.data?.items.some((b) => b.status === 'SENDING') ? 2000 : false,
  });
  const send = useMutation({
    mutationFn: () =>
      api.adminBroadcast({ text: text.trim(), segments, includeStaff }, key.current()),
    onSuccess: async () => {
      key.rotate();
      setConfirming(false);
      setText('');
      show(t('bc.started'));
      await client.invalidateQueries({ queryKey: ['admin', 'broadcasts'] });
    },
  });
  const change = (apply: () => void) => {
    key.rotate();
    send.reset();
    apply();
  };
  const toggle = (s: SegmentState) =>
    change(() =>
      setSegments((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s])),
    );

  const recipients = segments.length === 0 ? 0 : (preview.data?.recipients ?? null);
  const canSend = text.trim().length > 0 && text.length <= MAX && (recipients ?? 0) > 0;

  return (
    <div className="page">
      <PageHead title={t('bc.title')} />

      <div className="field">
        <label htmlFor="bc-text">{t('bc.text')}</label>
        <textarea
          id="bc-text"
          className="input"
          rows={6}
          maxLength={MAX}
          placeholder={t('bc.placeholder')}
          value={text}
          onChange={(e) => change(() => setText(e.target.value))}
        />
        <span className="muted small counter">
          {text.length}/{MAX}
        </span>
      </div>

      <div className="field">
        <span className="label">{t('bc.audience')}</span>
        <div className="chips" role="group" aria-label={t('bc.audience')}>
          {SEGMENTS.map((s) => (
            <button
              key={s}
              type="button"
              className="chip"
              aria-pressed={segments.includes(s)}
              onClick={() => toggle(s)}
            >
              {t(`bc.seg.${s}`)}
            </button>
          ))}
        </div>
      </div>

      <label className="setting-row">
        <span>{t('bc.staff')}</span>
        <span className="switch">
          <input
            type="checkbox"
            role="switch"
            checked={includeStaff}
            onChange={(e) => change(() => setIncludeStaff(e.target.checked))}
          />
          <span />
        </span>
      </label>

      <p className="muted" aria-live="polite">
        {recipients === null
          ? t('common.loading')
          : recipients === 0
            ? t('bc.noRecipients')
            : t('bc.recipients', { n: recipients })}
      </p>

      <Button disabled={!canSend} onClick={() => setConfirming(true)}>
        {t('bc.send')}
      </Button>

      <h2 className="section-title">{t('bc.history')}</h2>
      {history.isPending ? (
        <Spinner />
      ) : history.error ? (
        <ErrorBox error={history.error} onRetry={() => void history.refetch()} />
      ) : history.data.items.length === 0 ? (
        <div className="empty">{t('bc.none')}</div>
      ) : (
        <ul className="plain-list">
          {history.data.items.map((b) => (
            <li key={b.id} className="card bc-item">
              <div className="card-head">
                <span className="muted small">
                  {fullDate(b.createdAt)} {timeOf(b.createdAt)} · {b.createdBy}
                </span>
                <span className={`badge ${b.status === 'SENDING' ? 'is-expired' : ''}`}>
                  {t(`bc.status.${b.status}`)}
                </span>
              </div>
              <p className="bc-text">{b.text}</p>
              <p className="muted small">
                {b.segments.map((s) => t(`bc.seg.${s}`)).join(', ')}
                {b.includeStaff ? ` · ${t('bc.staff')}` : ''}
              </p>
              <p className="small">
                {t('bc.stats', {
                  sent: b.sent,
                  total: b.total,
                  blocked: b.blocked,
                  failed: b.failed,
                })}
              </p>
            </li>
          ))}
        </ul>
      )}

      {confirming && recipients !== null && (
        <Sheet
          title={t('bc.confirmTitle')}
          showTitle
          onClose={() => !send.isPending && setConfirming(false)}
        >
          <p className="bc-text card">{text.trim()}</p>
          <p className="sheet-note">{t('bc.confirmBody', { n: recipients })}</p>
          {send.error && (
            <p className="error-text" role="alert">
              {errorText(send.error)}
            </p>
          )}
          <Button busy={send.isPending} onClick={() => send.mutate()}>
            {t('bc.confirm', { n: recipients })}
          </Button>
          <Button variant="fill" disabled={send.isPending} onClick={() => setConfirming(false)}>
            {t('common.cancel')}
          </Button>
        </Sheet>
      )}
      <Toast toast={toast} />
    </div>
  );
}
