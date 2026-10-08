import { subscriptionRequestUrl } from '@nasiya/shared';
import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useI18n } from '../lib/i18n';
import { openLink, useBackButton } from '../lib/telegram';
import { useCore, useOptionalSession, useSession } from '../state/session';
import { IconBook, IconShield, IconStore } from './icons';

/** Tab sahifalari: pastki menyu ko'rinadi, Telegram "Orqaga" tugmasi yashirinadi. */
export const ROOT_PATHS = ['/', '/business', '/admin'];

/** Orqaga: tarix bo'lmasa (chuqur havola bilan ochilgan) — bosh sahifaga. */
export function useGoBack(): () => void {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(() => {
    if (location.key === 'default') void navigate('/', { replace: true });
    else void navigate(-1);
  }, [navigate, location.key]);
}

/** Obuna holati bannerlari (EXPIRED — yozish bloklangan; TRIAL ≤ 3 kun qolganda eslatma). */
export function SubscriptionBanner() {
  const { api, role, locale } = useSession();
  const { t } = useI18n();
  const q = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.dashboard(),
    staleTime: 30_000,
  });
  const sub = q.data?.subscription;
  const expired = sub?.state === 'EXPIRED';
  const endingSoon = sub?.state === 'TRIAL' && sub.daysLeft <= 3;
  // Uzaytirish so'rovi havolasi (faqat egasi: billing xodimga ochiq emas)
  const renewUrl = useQuery({
    queryKey: ['support', locale],
    queryFn: async () => {
      const billing = await api.billing();
      return billing.supportPhone
        ? subscriptionRequestUrl(billing.supportPhone, locale, billing.shortCode)
        : null;
    },
    enabled: role === 'OWNER' && (expired || endingSoon),
    staleTime: 600_000,
  });
  if (q.data?.business.suspended)
    return (
      <div className="banner banner-danger" role="alert">
        <span>{t('banner.suspended')}</span>
      </div>
    );
  if (!sub || !(expired || endingSoon)) return null;
  return (
    <div
      className={`banner ${expired ? 'banner-danger' : 'banner-warn'}`}
      role={expired ? 'alert' : undefined}
    >
      <span>{expired ? t('banner.expired') : t('banner.trial', { days: sub.daysLeft })}</span>
      {renewUrl.data && (
        <button type="button" className="banner-action" onClick={() => openLink(renewUrl.data!)}>
          {t('sub.pay')}
        </button>
      )}
    </div>
  );
}

export function Layout() {
  const { t } = useI18n();
  const session = useOptionalSession();
  const { isSuperadmin } = useCore();
  const location = useLocation();
  const goBack = useGoBack();
  const atRoot = ROOT_PATHS.includes(location.pathname);
  useBackButton(!atRoot, goBack);

  return (
    <div className="app">
      {session && <SubscriptionBanner />}
      <main className={`content ${atRoot ? 'with-tabbar' : ''}`}>
        <Outlet />
      </main>
      {atRoot && (
        <nav className="tabbar" aria-label={t('nav.main')}>
          {session && (
            <>
              <NavLink to="/" end>
                <IconBook />
                <span>{t('nav.book')}</span>
              </NavLink>
              <NavLink to="/business">
                <IconStore />
                <span>{t('nav.business')}</span>
              </NavLink>
            </>
          )}
          {isSuperadmin && (
            <NavLink to="/admin">
              <IconShield />
              <span>{t('nav.admin')}</span>
            </NavLink>
          )}
        </nav>
      )}
    </div>
  );
}
