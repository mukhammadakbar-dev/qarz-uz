import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, ErrorBox, Sheet, Spinner, useErrorText, useToast } from '../components/ui';
import { fullDate } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useIdempotencyKey } from '../lib/idempotency';
import { openLink } from '../lib/telegram';
import type { StaffMember } from '../lib/types';
import { useSession } from '../state/session';

export function Staff() {
  const { api } = useSession();
  const { t } = useI18n();
  const client = useQueryClient();
  const errorText = useErrorText();
  const { toast, show } = useToast();
  const key = useIdempotencyKey();
  const [revoking, setRevoking] = useState<StaffMember | null>(null);

  const staff = useQuery({ queryKey: ['staff'], queryFn: () => api.staff() });
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

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      show(t('common.copied'));
    } catch {
      show(text);
    }
  };

  if (staff.isPending) return <Spinner />;
  if (staff.error) return <ErrorBox error={staff.error} onRetry={() => void staff.refetch()} />;

  return (
    <div className="stack">
      <ul className="list">
        {staff.data.members.map((m) => (
          <li key={m.userId} className={`row ${m.status === 'REVOKED' ? 'entry-deleted' : ''}`}>
            <span className="name">
              {m.name}
              {m.username ? <small> @{m.username}</small> : null}
              <small>
                {' '}
                · {t(`role.${m.role}`)}
                {m.status === 'REVOKED' ? ` · ${t('staff.revoked')}` : ''}
              </small>
            </span>
            <span className="hint">{fullDate(m.joinedAt)}</span>
            {m.role === 'STAFF' && m.status === 'ACTIVE' && (
              <button
                className="icon-btn"
                aria-label={`${t('staff.revoke')} ${m.name}`}
                onClick={() => setRevoking(m)}
              >
                🗑
              </button>
            )}
          </li>
        ))}
      </ul>

      <Card>
        <Button busy={invite.isPending} onClick={() => invite.mutate()}>
          {t('staff.invite')}
        </Button>
        <p className="hint">{t('staff.inviteNote')}</p>
        {invite.error && <ErrorBox error={invite.error} />}
        {invite.data && (
          <div className="stack">
            <input
              className="input"
              readOnly
              aria-label="link"
              value={invite.data.link}
              onFocus={(e) => e.target.select()}
            />
            <div className="grid-2">
              <Button variant="secondary" onClick={() => void copy(invite.data!.link)}>
                {t('common.copy')}
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  openLink(`https://t.me/share/url?url=${encodeURIComponent(invite.data!.link)}`)
                }
              >
                {t('staff.share')}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {revoking && (
        <Sheet title={t('staff.revoke')} onClose={() => !revoke.isPending && setRevoking(null)}>
          <p>{t('staff.revokeConfirm', { name: revoking.name })}</p>
          {revoke.error && (
            <p className="error-text" role="alert">
              {errorText(revoke.error)}
            </p>
          )}
          <div className="grid-2">
            <Button
              variant="secondary"
              disabled={revoke.isPending}
              onClick={() => setRevoking(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              busy={revoke.isPending}
              onClick={() => revoke.mutate(revoking)}
            >
              {t('staff.revoke')}
            </Button>
          </div>
        </Sheet>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
