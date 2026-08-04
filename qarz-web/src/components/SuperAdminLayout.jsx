import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useTheme } from '../lib/theme.jsx';
import { Sun, Moon } from './icons.jsx';
import './Layout.css';
import './SuperAdminLayout.css';

const nav = [
  { to: '/super-admin', label: "Do'konlar", end: true, icon: ShopIcon },
  { to: '/super-admin/stats', label: 'Statistika', icon: ChartIcon },
  { to: '/super-admin/plans', label: 'Tariflar', icon: TagIcon },
  { to: '/super-admin/audit-log', label: 'Faoliyat jurnali', icon: LogIcon },
];

export default function SuperAdminLayout({ children }) {
  const { user, logout } = useAuth();
  const { isDark, toggle } = useTheme();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="layout sa-layout">
      <aside className="sidebar sa-sidebar">
        <div className="brand">
          <span className="brand-mark sa-mark">SA</span>
          <span className="brand-name">Super<span className="brand-dim">Admin</span></span>
        </div>

        <nav className="nav">
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
            <div className="user-dot sa-dot" />
            <div className="user-meta">
              <div className="user-phone">{user?.phone || 'Platforma egasi'}</div>
              <div className="user-role">Super Admin</div>
            </div>
          </div>
          <div className="foot-actions">
            <button className="logout" onClick={handleLogout}>Chiqish</button>
            <button className="theme-toggle" onClick={toggle}
              aria-label={isDark ? "Yorug' rejim" : "Qorong'i rejim"}>
              {isDark ? <Sun /> : <Moon />}
            </button>
          </div>
        </div>
      </aside>

      <main className="main">{children}</main>
    </div>
  );
}

function ShopIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 9l1.5-5h15L21 9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 9v11h16V9M9 20v-6h6v6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ChartIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <line x1="18" y1="20" x2="18" y2="10" strokeLinecap="round" />
      <line x1="12" y1="20" x2="12" y2="4" strokeLinecap="round" />
      <line x1="6" y1="20" x2="6" y2="14" strokeLinecap="round" />
    </svg>
  );
}
function TagIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M20 12 12.6 4.6a2 2 0 0 0-1.4-.6H5a1 1 0 0 0-1 1v6.2c0 .5.2 1 .6 1.4L12 20l8-8Z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7.5" cy="7.5" r="1.2" />
    </svg>
  );
}
function LogIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 4h13l3 3v13H4z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 10h8M8 14h8M8 18h5" strokeLinecap="round" />
    </svg>
  );
}
