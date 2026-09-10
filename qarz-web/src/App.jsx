import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { ThemeProvider } from './lib/theme.jsx';
import { ToastProvider } from './components/Toast.jsx';
import SuperAdminLayout from './components/SuperAdminLayout.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import Login from './pages/Login.jsx';
import SuperAdminDashboard from './pages/SuperAdminDashboard.jsx';
import SuperAdminShops from './pages/SuperAdminShops.jsx';
import SuperAdminPlans from './pages/SuperAdminPlans.jsx';
import SuperAdminBroadcast from './pages/SuperAdminBroadcast.jsx';
import SuperAdminAuditLog from './pages/SuperAdminAuditLog.jsx';

function SuperAdminProtected({ children }) {
  const auth = useAuth();
  const user = auth?.user;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'super_admin') return <Navigate to="/login" replace />;
  return <SuperAdminLayout>{children}</SuperAdminLayout>;
}

function PublicOnly({ children }) {
  const auth = useAuth();
  const user = auth?.user;
  if (user && user.role === 'super_admin') return <Navigate to="/super-admin" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <ErrorBoundary>
            <ToastProvider>
              <Routes>
                <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />

                <Route path="/super-admin" element={<SuperAdminProtected><SuperAdminDashboard /></SuperAdminProtected>} />
                <Route path="/super-admin/shops" element={<SuperAdminProtected><SuperAdminShops /></SuperAdminProtected>} />
                <Route path="/super-admin/plans" element={<SuperAdminProtected><SuperAdminPlans /></SuperAdminProtected>} />
                <Route path="/super-admin/broadcast" element={<SuperAdminProtected><SuperAdminBroadcast /></SuperAdminProtected>} />
                <Route path="/super-admin/audit-log" element={<SuperAdminProtected><SuperAdminAuditLog /></SuperAdminProtected>} />

                <Route path="*" element={<Navigate to="/super-admin" replace />} />
              </Routes>
            </ToastProvider>
          </ErrorBoundary>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
