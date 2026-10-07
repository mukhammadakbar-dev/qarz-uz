import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiClient, ApiError } from '../lib/api';
import { I18nProvider, useI18n } from '../lib/i18n';
import type { Locale, Me, Role } from '../lib/types';
import { Centered } from '../components/ui';

export interface Session {
  readonly api: ApiClient;
  readonly me: Me;
  readonly businessId: string;
  readonly role: Role;
  readonly locale: Locale;
  switchBusiness(businessId: string): Promise<void>;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('SessionProvider kerak');
  return s;
}

/**
 * Kirish darvozasi: autentifikatsiya → /api/me → biznes tanlash. Hammasi tayyor bo'lgandan keyingina ilova ko'rsatiladi.
 * Biznes ID si faqat selektor: server har so'rovda a'zolikni tekshiradi.
 */
export function SessionProvider({ api, children }: { api: ApiClient; children: ReactNode }) {
  const client = useQueryClient();
  const meQuery = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  const [chosen, setChosen] = useState<string | null>(null);

  const me = meQuery.data;
  const businessId =
    chosen && me?.businesses.some((b) => b.id === chosen)
      ? chosen
      : ((me?.activeBusinessId && me.businesses.some((b) => b.id === me.activeBusinessId)
          ? me.activeBusinessId
          : null) ?? (me?.businesses.length === 1 ? me.businesses[0]!.id : null));

  api.businessId = businessId;

  const switchBusiness = useCallback(
    async (id: string) => {
      await api.switchBusiness(id);
      api.businessId = id;
      setChosen(id);
      client.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    },
    [api, client],
  );

  const locale: Locale = me?.user.locale ?? 'uz-Latn';

  useEffect(() => {
    document.documentElement.lang = locale === 'uz-Cyrl' ? 'uz-Cyrl' : 'uz';
  }, [locale]);

  const value = useMemo<Session | null>(() => {
    if (!me || !businessId) return null;
    const role = me.businesses.find((b) => b.id === businessId)!.role;
    return { api, me, businessId, role, locale, switchBusiness };
  }, [api, me, businessId, locale, switchBusiness]);

  return (
    <I18nProvider locale={locale}>
      <Gate meQuery={meQuery} me={me} hasBusiness={businessId !== null} onPick={switchBusiness}>
        <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
      </Gate>
    </I18nProvider>
  );
}

function Gate({
  meQuery,
  me,
  hasBusiness,
  onPick,
  children,
}: {
  meQuery: { isPending: boolean; error: Error | null; refetch: () => unknown };
  me: Me | undefined;
  hasBusiness: boolean;
  onPick: (id: string) => Promise<void>;
  children: ReactNode;
}) {
  const { t } = useI18n();
  if (meQuery.isPending) return <Centered>{t('common.loading')}</Centered>;
  if (meQuery.error || !me) {
    const auth =
      meQuery.error instanceof ApiError &&
      (meQuery.error.status === 401 || meQuery.error.status === 400);
    return (
      <Centered>
        <p>{auth ? t('error.notTelegram') : t('error.generic')}</p>
        {!auth && (
          <button className="btn" onClick={() => void meQuery.refetch()}>
            {t('common.retry')}
          </button>
        )}
      </Centered>
    );
  }
  if (me.businesses.length === 0) return <Centered>{t('error.noBusiness')}</Centered>;
  if (!hasBusiness) {
    // Bir nechta biznes, hech biri tanlanmagan
    return (
      <Centered>
        <p>{t('switcher.label')}</p>
        {me.businesses.map((b) => (
          <button key={b.id} className="btn" onClick={() => void onPick(b.id)}>
            {b.name}
          </button>
        ))}
      </Centered>
    );
  }
  return <>{children}</>;
}
