import { useEffect } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { AddEntry } from './pages/AddEntry';
import { CustomerDetail } from './pages/CustomerDetail';
import { CustomerNew } from './pages/CustomerNew';
import { Customers } from './pages/Customers';
import { Dashboard } from './pages/Dashboard';
import { Settings } from './pages/Settings';
import { Staff } from './pages/Staff';
import { useSession } from './state/session';

const DEEP_LINK = /^c_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function App({ startParam }: { startParam: string | null }) {
  const { role } = useSession();
  const navigate = useNavigate();

  // Botdan kelgan chuqur havola: startapp=c_<mijoz-id> → mijoz sahifasi (id baribir serverda tekshiriladi)
  useEffect(() => {
    const match = startParam ? DEEP_LINK.exec(startParam) : null;
    if (match) void navigate(`/customers/${match[1]}`, { replace: true });
  }, [startParam, navigate]);

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="customers" element={<Customers />} />
        <Route path="customers/new" element={<CustomerNew />} />
        <Route path="customers/:id" element={<CustomerDetail />} />
        <Route path="customers/:id/add/:kind" element={<AddEntry />} />
        <Route path="staff" element={role === 'OWNER' ? <Staff /> : <Navigate to="/" replace />} />
        <Route
          path="settings"
          element={role === 'OWNER' ? <Settings /> : <Navigate to="/" replace />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
