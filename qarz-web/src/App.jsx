import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { ThemeProvider } from './lib/theme.jsx';
import { ToastProvider } from './components/Toast.jsx';
import Layout from './components/Layout.jsx';
import SuperAdminLayout from './components/SuperAdminLayout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Debtors from './pages/Debtors.jsx';
import Sales from './pages/Sales.jsx';
import Staff from './pages/Staff.jsx';
import SuperAdminShops from './pages/SuperAdminShops.jsx';
import SuperAdminPlans from './pages/SuperAdminPlans.jsx';
import SuperAdminAuditLog from './pages/SuperAdminAuditLog.jsx';

function Protected({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  // A super_admin has no shop-owner data to see on these routes — send them
  // to their own panel instead of a shop dashboard that isn't theirs.
  if (user.role === 'super_admin') return <Navigate to="/super-admin" replace />;
  return <Layout>{children}</Layout>;
}

/** Dashboard/daily-sales are shop-only on the backend (authorize('shop_owner',
 *  'staff')) — a personal (free) user has no shop and would just see every
 *  request 403. Route them to the page that IS theirs instead. */
function ShopOnly({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (user.role === 'super_admin') return <Navigate to="/super-admin" replace />;
  if (user.role === 'personal') return <Navigate to="/debtors" replace />;
  return <Layout>{children}</Layout>;
}

/** The home route means different things per role: shop owners/staff land on
 *  the shop dashboard, personal users land directly on their debtor ledger
 *  (they have no shop-wide stats to show). */
function HomeRoute() {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (user.role === 'super_admin') return <Navigate to="/super-admin" replace />;
  if (user.role === 'personal') return <Layout><Debtors /></Layout>;
  return <Layout><Dashboard /></Layout>;
}

/** Staff management is owner-only on the backend; keep the frontend consistent
 *  rather than showing a page whose every action returns 403. */
function OwnerOnly({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (user.role === 'super_admin') return <Navigate to="/super-admin" replace />;
  if (user.role !== 'shop_owner') return <Navigate to="/" replace />;
  return <Layout>{children}</Layout>;
}

/** Guards the /super-admin/* tree: separate role, separate interface. */
function SuperAdminProtected({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (user.role !== 'super_admin') return <Navigate to="/" replace />;
  return <SuperAdminLayout>{children}</SuperAdminLayout>;
}

function PublicOnly({ children }) {
  const { user } = useAuth();
  if (user) return <Navigate to={user.role === 'super_admin' ? '/super-admin' : '/'} replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <Routes>
              <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />

              <Route path="/" element={<HomeRoute />} />
              <Route path="/debtors" element={<Protected><Debtors /></Protected>} />
              <Route path="/sales" element={<ShopOnly><Sales /></ShopOnly>} />
              <Route path="/staff" element={<OwnerOnly><Staff /></OwnerOnly>} />

              <Route path="/super-admin" element={<SuperAdminProtected><SuperAdminShops /></SuperAdminProtected>} />
              <Route path="/super-admin/plans" element={<SuperAdminProtected><SuperAdminPlans /></SuperAdminProtected>} />
              <Route path="/super-admin/audit-log" element={<SuperAdminProtected><SuperAdminAuditLog /></SuperAdminProtected>} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
