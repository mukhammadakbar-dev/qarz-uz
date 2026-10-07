import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Button, Card, ErrorBox, Spinner, useToast } from '../components/ui';
import { fullDate, money } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useSession } from '../state/session';

export function Settings() {
  const { api, locale } = useSession();
  const { t } = useI18n();
  const client = useQueryClient();
  const { toast, show } = useToast();
  const business = useQuery({ queryKey: ['business'], queryFn: () => api.business() });
  const billing = useQuery({ queryKey: ['billing'], queryFn: () => api.billing() });

  const [name, setName] = useState('');
  const [notify, setNotify] = useState(true);
  useEffect(() => {
    if (business.data) {
      setName(business.data.name);
      setNotify(business.data.notifyOwnerOnDelete);
    }
  }, [business.data]);

  const save = useMutation({
    mutationFn: () => api.updateBusiness({ name, notifyOwnerOnDelete: notify }),
    onSuccess: async () => {
      show(t('common.saved'));
      await Promise.all(
        ['business', 'dashboard', 'me'].map((k) => client.invalidateQueries({ queryKey: [k] })),
      );
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  if (business.isPending) return <Spinner />;
  if (business.error)
    return <ErrorBox error={business.error} onRetry={() => void business.refetch()} />;

  return (
    <div className="stack">
      <form className="stack" onSubmit={submit}>
        <div className="field">
          <label htmlFor="bname">{t('settings.businessName')}</label>
          <input
            id="bname"
            className="input"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <label className="check">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          <span>{t('settings.notify')}</span>
        </label>
        {save.error && <ErrorBox error={save.error} />}
        <Button type="submit" busy={save.isPending} disabled={!name.trim()}>
          {t('common.save')}
        </Button>
      </form>

      <Card>
        <h2>{t('billing.title')}</h2>
        {billing.isPending ? (
          <Spinner />
        ) : billing.error ? (
          <ErrorBox error={billing.error} onRetry={() => void billing.refetch()} />
        ) : (
          <div className="stack">
            <div>
              <strong>{t(`billing.state.${billing.data.status.state}`)}</strong>
              {billing.data.status.state !== 'EXPIRED' && (
                <span className="hint">
                  {' '}
                  {t('billing.until', {
                    date: fullDate(billing.data.status.until),
                    days: billing.data.status.daysLeft,
                  })}
                </span>
              )}
            </div>
            <div className="hint">
              {t('billing.price', { price: money(billing.data.priceUzs, locale) })}
            </div>
            <div>{t('billing.code', { code: billing.data.shortCode })}</div>
            <div className="hint">{t('billing.howto')}</div>
            {billing.data.supportPhone && (
              <a href={`tel:${billing.data.supportPhone}`}>
                {t('billing.contact', { phone: billing.data.supportPhone })}
              </a>
            )}
          </div>
        )}
      </Card>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
