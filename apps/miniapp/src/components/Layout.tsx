import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useI18n } from '../lib/i18n';
import { useBackButton } from '../lib/telegram';
import { useSession } from '../state/session';

/** Obuna holati bannerlari (EXPIRED — yozish bloklangan; TRIAL ≤ 3 kun qolganda eslatma). */
export function SubscriptionBanner() {
  const { api } = useSession();
  const { t } = useI18n();
  const q = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.dashboard(),
    staleTime: 30_000,
  });
  const billingPhone = useQuery({
    queryKey: ['support'],
    queryFn: async () => {
      try {
        return (await api.billing()).supportPhone;
      } catch {
        return null; // xodimga billing ochiq emas
      }
    },
    enabled: q.data?.subscription.state === 'EXPIRED',
    staleTime: 600_000,
  });
  const sub = q.data?.subscription;
  if (!sub) return null;
  if (sub.state === 'EXPIRED') {
    return (
      <div className="banner banner-danger" role="alert">
        {t('banner.expired')}
        {billingPhone.data ? ` ${t('banner.pay', { phone: billingPhone.data })}` : ''}
      </div>
    );
  }
  if (sub.state === 'TRIAL' && sub.daysLeft <= 3) {
    return <div className="banner banner-warn">{t('banner.trial', { days: sub.daysLeft })}</div>;
  }
  return null;
}

export function Layout() {
  const { me, businessId, role, switchBusiness } = useSession();
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const atRoot = ['/', '/customers', '/staff', '/settings'].includes(location.pathname);
  useBackButton(!atRoot, () => navigate(-1));

  return (
    <div className="app">
      <header className="topbar">
        {me.businesses.length > 1 ? (
          <select
            aria-label={t('switcher.label')}
            className="switcher"
            value={businessId}
            onChange={(e) => void switchBusiness(e.target.value).then(() => navigate('/'))}
          >
            {me.businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        ) : (
          <strong>{me.businesses[0]?.name}</strong>
        )}
        <span className="role">{t(`role.${role}`)}</span>
      </header>
      <SubscriptionBanner />
      <main className="content">
        <Outlet />
      </main>
      <nav className="tabbar" aria-label="Asosiy menyu">
        <NavLink to="/" end>
          {t('nav.home')}
        </NavLink>
        <NavLink to="/customers">{t('nav.customers')}</NavLink>
        {role === 'OWNER' && <NavLink to="/staff">{t('nav.staff')}</NavLink>}
        {role === 'OWNER' && <NavLink to="/settings">{t('nav.settings')}</NavLink>}
      </nav>
    </div>
  );
}
