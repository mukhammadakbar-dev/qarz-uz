import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useTheme } from '../lib/theme.jsx';
import { Sun, Moon } from './icons.jsx';
import './SuperAdminLayout.css';

const nav = [
  { to: '/super-admin', label: 'Boshqaruv Paneli', end: true, icon: HomeIcon },
  { to: '/super-admin/shops', label: "Do'konlar", icon: ShopIcon },
  { to: '/super-admin/plans', label: 'Tariflar', icon: TagIcon },
  { to: '/super-admin/broadcast', label: "E'lonlar (Broadcast)", icon: BroadcastIcon },
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
          <span className="brand-mark sa-mark">TD</span>
          <span className="brand-name">Temir<span className="brand-dim">Daftar</span></span>
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

function HomeIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="9 22 9 12 15 12 15 22" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
function TagIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M20 12 12.6 4.6a2 2 0 0 0-1.4-.6H5a1 1 0 0 0-1 1v6.2c0 .5.2 1 .6 1.4L12 20l8-8Z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7.5" cy="7.5" r="1.2" />
    </svg>
  );
}
function BroadcastIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M22 2L11 13" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M22 2L15 22L11 13L2 9L22 2Z" strokeLinecap="round" strokeLinejoin="round"/>
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
