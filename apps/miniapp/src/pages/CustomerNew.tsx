import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, ErrorBox, PageHead } from '../components/ui';
import { useIdempotencyKey } from '../lib/idempotency';
import { useI18n } from '../lib/i18n';
import { useSession } from '../state/session';

/**
 * Yangi mijoz. `?name=` qidiruvdan ismni oladi; `?then=debt|payment` — yaratilgach darhol yozuv ekraniga o'tadi
 * (tanlash → yaratish → summa: bitta oqim).
 */
export function CustomerNew() {
  const { api } = useSession();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const then = params.get('then');
  const client = useQueryClient();
  const key = useIdempotencyKey();
  const [form, setForm] = useState({
    name: params.get('name') ?? '',
    label: '',
    phone: '',
    notes: '',
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    key.rotate(); // ma'lumot o'zgardi — yangi niyat
    setForm({ ...form, [k]: e.target.value });
  };

  const create = useMutation({
    mutationFn: () =>
      api.createCustomer(
        {
          name: form.name.trim(),
          ...(form.label.trim() ? { label: form.label.trim() } : {}),
          ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
          ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
        },
        key.current(),
      ),
    onSuccess: async (c) => {
      key.rotate();
      await client.invalidateQueries({ queryKey: ['customers'] });
      const next =
        then === 'debt' || then === 'payment'
          ? `/customers/${c.id}/add/${then}`
          : `/customers/${c.id}`;
      void navigate(next, { replace: true });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (form.name.trim()) create.mutate();
  };

  return (
    <form className="page form" onSubmit={submit}>
      <PageHead title={t('new.title')} />
      <div className="field">
        <label htmlFor="name">{t('field.name')}</label>
        <input
          id="name"
          className="input"
          value={form.name}
          onChange={set('name')}
          autoFocus
          maxLength={100}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="phone">{t('field.phone')}</label>
        <input
          id="phone"
          className="input"
          type="tel"
          inputMode="tel"
          placeholder="+998 90 123 45 67"
          value={form.phone}
          onChange={set('phone')}
        />
      </div>
      <div className="field">
        <label htmlFor="label">{t('field.label')}</label>
        <input
          id="label"
          className="input"
          value={form.label}
          onChange={set('label')}
          maxLength={50}
        />
      </div>
      <div className="field">
        <label htmlFor="notes">{t('field.notes')}</label>
        <textarea
          id="notes"
          className="input"
          rows={3}
          value={form.notes}
          onChange={set('notes')}
          maxLength={500}
        />
      </div>
      {create.error && <ErrorBox error={create.error} />}
      <Button type="submit" busy={create.isPending} disabled={!form.name.trim()}>
        {t('new.create')}
      </Button>
    </form>
  );
}
