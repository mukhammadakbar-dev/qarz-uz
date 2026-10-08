import { subscriptionRequestUrl } from '@nasiya/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { IconPencil, IconPlus } from '../components/icons';
import {
  Avatar,
  Button,
  ErrorBox,
  Sheet,
  Spinner,
  Toast,
  useErrorText,
  useToast,
} from '../components/ui';
import { fullDate, money } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useIdempotencyKey } from '../lib/idempotency';
import { openLink } from '../lib/telegram';
import type { Locale, StaffMember, Subscription } from '../lib/types';
import { useSession } from '../state/session';

/** Alifbo nomlari o'z yozuvida (qaysi tilda bo'lmasin, foydalanuvchi o'zinikini taniydi). */
const SCRIPTS: readonly { locale: Locale; label: string }[] = [
  { locale: 'uz-Latn', label: 'Lotin' },
  { locale: 'uz-Cyrl', label: 'Кирилл' },
];

/** Biznes: nom, obuna, xodimlar va sozlamalar (egasi), alifbo (hamma). */
export function Business() {
  const { api, role } = useSession();
  const { t } = useI18n();
  const owner = role === 'OWNER';
  const { toast, show } = useToast();
  const dash = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.dashboard(),
    staleTime: 30_000,
  });

  if (dash.isPending) return <Spinner />;
  if (dash.error) return <ErrorBox error={dash.error} onRetry={() => void dash.refetch()} />;

  return (
    <div className="page">
      <BusinessName
        name={dash.data.business.name}
        editable={owner}
        onSaved={() => show(t('common.saved'))}
      />
      <SubscriptionCard fallback={dash.data.subscription} owner={owner} />
      {owner && <StaffCard onToast={show} />}
      <ScriptSwitch />
      <Toast toast={toast} aboveTabbar />
    </div>
  );
}

function BusinessName({
  name,
  editable,
  onSaved,
}: {
  name: string;
  editable: boolean;
  onSaved: () => void;
}) {
  const { api } = useSession();
  const { t } = useI18n();
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const save = useMutation({
    mutationFn: () => api.updateBusiness({ name: value.trim() }),
    onSuccess: async () => {
      setEditing(false);
      onSaved();
      await Promise.all(
        ['business', 'dashboard', 'me'].map((k) => client.invalidateQueries({ queryKey: [k] })),
      );
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim()) save.mutate();
  };

  if (editing)
    return (
      <form className="form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="bname">{t('biz.name')}</label>
          <input
            id="bname"
            className="input"
            value={value}
            maxLength={100}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        {save.error && <ErrorBox error={save.error} />}
        <div className="grid-2">
          <Button variant="fill" disabled={save.isPending} onClick={() => setEditing(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" busy={save.isPending} disabled={!value.trim()}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    );

  return (
    <div className="title-row">
      <div className="hero">
        <span className="label">{t('biz.label')}</span>
        <span className="customer-name">{name}</span>
      </div>
      {editable && (
        <button
          type="button"
          className="icon-btn"
          aria-label={t('biz.rename')}
          onClick={() => {
            setValue(name);
            setEditing(true);
          }}
        >
          <IconPencil />
        </button>
      )}
    </div>
  );
}

function SubscriptionCard({ fallback, owner }: { fallback: Subscription; owner: boolean }) {
  const { api, locale } = useSession();
  const { t } = useI18n();
  // Narx, kod va admin raqami faqat egasiga ochiq; xodim holatni dashboard'dan ko'radi
  const billing = useQuery({
    queryKey: ['billing'],
    queryFn: () => api.billing(),
    enabled: owner,
  });
  const status = billing.data?.status ?? fallback;
  const expired = status.state === 'EXPIRED';
  const total = Math.max(status.state === 'TRIAL' ? 14 : 30, status.daysLeft);
  const phone = billing.data?.supportPhone;

  return (
    <section className="card" aria-label={t('sub.title')}>
      <div className="card-head">
        <span>{t('sub.title')}</span>
        <span className={`badge ${expired ? 'is-expired' : ''}`}>
          {t(`sub.state.${status.state}`)}
        </span>
      </div>
      {expired ? (
        <p className="muted">{t('sub.expiredBody')}</p>
      ) : (
        <>
          <div className="big-line">
            <strong>{t('sub.days', { days: status.daysLeft })}</strong>
            <span className="muted">{t('sub.until', { date: fullDate(status.until) })}</span>
          </div>
          <div
            className="progress"
            role="progressbar"
            aria-label={t('sub.title')}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={status.daysLeft}
          >
            <div style={{ width: `${Math.round((status.daysLeft / total) * 100)}%` }} />
          </div>
        </>
      )}
      {owner && billing.error && (
        <ErrorBox error={billing.error} onRetry={() => void billing.refetch()} />
      )}
      {billing.data && (
        <>
          <p className="muted">{t('sub.price', { price: money(billing.data.priceUzs, locale) })}</p>
          <p className="muted">{t('sub.code', { code: billing.data.shortCode })}</p>
          {phone && (
            <>
              <Button
                onClick={() =>
                  openLink(subscriptionRequestUrl(phone, locale, billing.data!.shortCode))
                }
              >
                {t('sub.pay')}
              </Button>
              <p className="muted small">{t('sub.payHint')}</p>
            </>
          )}
        </>
      )}
    </section>
  );
}

function StaffCard({ onToast }: { onToast: (text: string) => void }) {
  const { api, me } = useSession();
  const { t } = useI18n();
  const client = useQueryClient();
  const errorText = useErrorText();
  const key = useIdempotencyKey();
  const [revoking, setRevoking] = useState<StaffMember | null>(null);

  const staff = useQuery({ queryKey: ['staff'], queryFn: () => api.staff() });
  const business = useQuery({ queryKey: ['business'], queryFn: () => api.business() });
  const invite = useMutation({
    mutationFn: () => api.invite(key.current()),
    onSuccess: () => key.rotate(), // keyingi bosish yangi taklif beradi
  });
  const revoke = useMutation({
    mutationFn: (m: StaffMember) => api.revoke(m.userId),
    onSuccess: async () => {
      setRevoking(null);
      await client.invalidateQueries({ queryKey: ['staff'] });
    },
  });
  const notify = useMutation({
    mutationFn: (value: boolean) => api.updateBusiness({ notifyOwnerOnDelete: value }),
    onSuccess: async () => {
      onToast(t('common.saved'));
      await client.invalidateQueries({ queryKey: ['business'] });
    },
  });

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onToast(t('common.copied'));
    } catch {
      onToast(text);
    }
  };

  const members = staff.data?.members ?? [];
  const active = members.filter((m) => m.status === 'ACTIVE').length;
  const notifyOn = notify.isPending
    ? Boolean(notify.variables)
    : (business.data?.notifyOwnerOnDelete ?? true);

  return (
    <section className="card" aria-label={t('staff.title')}>
      <div className="card-head">
        <span>{t('staff.title')}</span>
        {staff.data && <span className="muted">{active}</span>}
      </div>
      {staff.isPending ? (
        <Spinner />
      ) : staff.error ? (
        <ErrorBox error={staff.error} onRetry={() => void staff.refetch()} />
      ) : (
        <ul className="plain-list">
          {members.map((m) => (
            <li
              key={m.userId}
              className={`staff-row ${m.status === 'REVOKED' ? 'is-revoked' : ''}`}
            >
              <Avatar name={m.name} small />
              <div className="who">
                <strong>
                  {m.name}
                  {m.userId === me.user.id ? ` ${t('staff.you')}` : ''}
                </strong>
                <span>
                  {m.status === 'REVOKED'
                    ? `${t(`role.${m.role}`)} · ${t('staff.revoked')}`
                    : t('staff.since', { role: t(`role.${m.role}`), date: fullDate(m.joinedAt) })}
                </span>
              </div>
              {m.role === 'STAFF' && m.status === 'ACTIVE' && (
                <Button
                  variant="text"
                  aria-label={`${t('staff.revoke')} ${m.name}`}
                  onClick={() => setRevoking(m)}
                >
                  {t('staff.revoke')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Button variant="dashed" busy={invite.isPending} onClick={() => invite.mutate()}>
        <IconPlus size={18} />
        {t('staff.invite')}
      </Button>
      {invite.error && <ErrorBox error={invite.error} />}
      {invite.data && (
        <div className="link-box">
          <input
            className="input"
            readOnly
            aria-label={t('staff.link')}
            value={invite.data.link}
            onFocus={(e) => e.target.select()}
          />
          <div className="grid-2">
            <Button variant="fill" onClick={() => void copy(invite.data!.link)}>
              {t('common.copy')}
            </Button>
            <Button
              onClick={() =>
                openLink(`https://t.me/share/url?url=${encodeURIComponent(invite.data!.link)}`)
              }
            >
              {t('staff.share')}
            </Button>
          </div>
          <p className="muted">{t('staff.inviteNote')}</p>
        </div>
      )}

      <label className="setting-row">
        <span>{t('settings.notify')}</span>
        <span className="switch">
          <input
            type="checkbox"
            role="switch"
            checked={notifyOn}
            disabled={business.isPending || notify.isPending}
            onChange={(e) => notify.mutate(e.target.checked)}
          />
          <span />
        </span>
      </label>
      {notify.error && <ErrorBox error={notify.error} />}

      {revoking && (
        <Sheet
          title={t('staff.revokeTitle')}
          showTitle
          onClose={() => !revoke.isPending && setRevoking(null)}
        >
          <p className="sheet-note">{t('staff.revokeConfirm', { name: revoking.name })}</p>
          {revoke.error && (
            <p className="error-text" role="alert">
              {errorText(revoke.error)}
            </p>
          )}
          <Button variant="danger" busy={revoke.isPending} onClick={() => revoke.mutate(revoking)}>
            {t('staff.revoke')}
          </Button>
          <Button variant="fill" disabled={revoke.isPending} onClick={() => setRevoking(null)}>
            {t('common.cancel')}
          </Button>
        </Sheet>
      )}
    </section>
  );
}

function ScriptSwitch() {
  const { api, locale } = useSession();
  const { t } = useI18n();
  const client = useQueryClient();
  const change = useMutation({
    mutationFn: (l: Locale) => api.setLocale(l),
    onSuccess: () => client.invalidateQueries({ queryKey: ['me'] }),
  });
  const current = change.isPending && change.variables ? change.variables : locale;
  return (
    <>
      <section className="setting-row">
        <span>{t('lang.title')}</span>
        <div className="segmented segmented-sm" role="group" aria-label={t('lang.title')}>
          {SCRIPTS.map((s) => (
            <button
              key={s.locale}
              type="button"
              lang={s.locale === 'uz-Cyrl' ? 'uz-Cyrl' : 'uz'}
              aria-pressed={current === s.locale}
              disabled={change.isPending}
              onClick={() => s.locale !== locale && change.mutate(s.locale)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </section>
      {change.error && <ErrorBox error={change.error} />}
    </>
  );
}
