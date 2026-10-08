import { useEffect } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { AddEntry } from './pages/AddEntry';
import { AdminBroadcast } from './pages/admin/AdminBroadcast';
import { AdminCustomer } from './pages/admin/AdminCustomer';
import { AdminHome } from './pages/admin/AdminHome';
import { AdminShop } from './pages/admin/AdminShop';
import { Business } from './pages/Business';
import { CustomerDetail } from './pages/CustomerDetail';
import { CustomerNew } from './pages/CustomerNew';
import { Home } from './pages/Home';
import { PickCustomer } from './pages/PickCustomer';
import { useCore, useOptionalSession } from './state/session';

const DEEP_LINK = /^c_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function App({ startParam }: { startParam: string | null }) {
  const navigate = useNavigate();
  const session = useOptionalSession();
  const { isSuperadmin } = useCore();

  // Botdan kelgan chuqur havola: startapp=c_<mijoz-id> → mijoz sahifasi (id baribir serverda tekshiriladi)
  useEffect(() => {
    const match = session && startParam ? DEEP_LINK.exec(startParam) : null;
    if (match) void navigate(`/customers/${match[1]}`, { replace: true });
  }, [session, startParam, navigate]);

  // Superadmin paneli: faqat SUPERADMIN_TELEGRAM_IDS (server har so'rovda tekshiradi)
  const admin = isSuperadmin && (
    <>
      <Route path="admin" element={<AdminHome />} />
      <Route path="admin/broadcast" element={<AdminBroadcast />} />
      <Route path="admin/shops/:id" element={<AdminShop />} />
      <Route path="admin/shops/:id/customers/:customerId" element={<AdminCustomer />} />
    </>
  );

  if (!session)
    // Do'koni yo'q superadmin: faqat panel
    return (
      <Routes>
        <Route element={<Layout />}>
          {admin}
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Route>
      </Routes>
    );

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="pick/:kind" element={<PickCustomer />} />
        <Route path="customers/new" element={<CustomerNew />} />
        <Route path="customers/:id" element={<CustomerDetail />} />
        <Route path="customers/:id/add/:kind" element={<AddEntry />} />
        <Route path="business" element={<Business />} />
        {admin}
        {/* Eski manzillar (oldingi versiya havolalari) */}
        <Route path="customers" element={<Navigate to="/" replace />} />
        <Route path="staff" element={<Navigate to="/business" replace />} />
        <Route path="settings" element={<Navigate to="/business" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
