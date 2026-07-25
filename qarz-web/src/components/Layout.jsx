import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useTheme } from '../lib/theme.jsx';
import { Sun, Moon, Shield } from './icons.jsx';
import './Layout.css';

const shopNav = [
  { to: '/', label: 'Boshqaruv paneli', end: true, icon: GridIcon },
  { to: '/debtors', label: 'Qarzdorlar', icon: UsersIcon },
  { to: '/sales', label: 'Kunlik savdo', icon: ChartIcon },
];
// Personal (free) users have no shop, so no dashboard stats or daily sales —
// just their own two-directional debt ledger.
const personalNav = [
  { to: '/', label: 'Mening qarzlarim', end: true, icon: UsersIcon },
];
// Staff management is owner-only on the backend (authorize('shop_owner')),
// so hide the link entirely for staff accounts rather than show a page that
// always errors on submit.
const ownerOnlyNav = [
  { to: '/staff', label: 'Xodimlar', icon: StaffIcon },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const { isDark, toggle } = useTheme();
  const navigate = useNavigate();
  const nav =
    user?.role === 'personal'
      ? personalNav
      : user?.role === 'shop_owner'
        ? [...shopNav, ...ownerOnlyNav]
        : shopNav;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">Q</span>
          <span className="brand-name">Qarz<span className="brand-dim">.uz</span></span>
        </div>

        <nav className="nav">
          {user?.role === 'super_admin' && (
            <NavLink
              to="/super-admin"
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Shield />
              <span>Super Admin</span>
            </NavLink>
          )}
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <item.icon />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="user-chip">
            <div className="user-dot" />
            <div className="user-meta">
              <div className="user-phone">{user?.phone || 'Do\'kon egasi'}</div>
              <div className="user-role">Admin</div>
            </div>
          </div>
          <div className="foot-actions">
            <button className="logout" onClick={handleLogout}>Chiqish</button>
            <button
              className="theme-toggle"
              onClick={toggle}
              aria-label={isDark ? 'Yorug\' rejim' : 'Qorong\'i rejim'}
              title={isDark ? 'Yorug\' rejim' : 'Qorong\'i rejim'}
            >
              {isDark ? <Sun /> : <Moon />}
            </button>
          </div>
        </div>
      </aside>

      <main className="main">{children}</main>
    </div>
  );
}

/* ---- inline icons (stroke, 20px) ---- */
function GridIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}
function UsersIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M16 5.5a3 3 0 0 1 0 5.8M18 20c0-2.4-1-4.4-2.6-5.6" />
    </svg>
  );
}
function StaffIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="7" width="18" height="13" rx="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 12h18" />
    </svg>
  );
}
function ChartIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" strokeLinecap="round" />
    </svg>
  );
}
