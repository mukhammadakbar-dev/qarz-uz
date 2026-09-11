import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';
import './SuperAdminDashboard.css';

function money(val) {
  if (val == null) return '0 so\'m';
  return String(Math.round(Number(val))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' so\'m';
}

export default function SuperAdminDashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recentLogs, setRecentLogs] = useState([]);
  const toast = useToast();

  useEffect(() => {
    Promise.all([
      api.adminStats().catch((err) => {
        toast(err.message, 'error');
        return null;
      }),
      api.adminAuditLog().catch(() => []),
    ]).then(([sData, lData]) => {
      setStats(sData);
      setRecentLogs(Array.isArray(lData) ? lData.slice(0, 5) : []);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="sa-dash-loading">
        <span className="spinner" />
      </div>
    );
  }

  return (
    <div className="sa-dash">
      <div className="page-head">
        <div>
          <h2>Boshqaruv Paneli</h2>
          <p className="subtext">TemirDaftar platformasi umumiy ko'rsatkichlari va tezkor boshqaruv</p>
        </div>
      </div>

      <div className="dash-grid">
        <div className="stat-card">
          <div className="stat-title">Total Do'konlar</div>
          <div className="stat-value">{stats?.totalShops || 0}</div>
          <div className="stat-sub">Ro'yxatdan o'tgan sub'ektlar</div>
        </div>

        <div className="stat-card accent-green">
          <div className="stat-title">Faol Obunalar</div>
          <div className="stat-value">{stats?.activeSubscriptions || 0}</div>
          <div className="stat-sub">Aktiv va sinov muddatidagi</div>
        </div>

        <div className="stat-card accent-blue">
          <div className="stat-title">Shu oygi Tushum</div>
          <div className="stat-value">{money(stats?.collectedThisMonth)}</div>
          <div className="stat-sub">Yig'ilgan a'zolik to'lovlari</div>
        </div>

        <div className="stat-card accent-purple">
          <div className="stat-title">Platformadagi Qarzlar</div>
          <div className="stat-value">{money(stats?.totalPlatformDebt)}</div>
          <div className="stat-sub">{stats?.totalDebtors || 0} ta qarzdor mijozlar bo'yicha</div>
        </div>

        <div className="stat-card accent-amber">
          <div className="stat-title">Shu oygi SMSlar</div>
          <div className="stat-value">{stats?.smsThisMonth || 0}</div>
          <div className="stat-sub">Yuborilgan eslatma SMSlari</div>
        </div>

        <div className="stat-card accent-teal">
          <div className="stat-title">Bot Foydalanuvchilari</div>
          <div className="stat-value">{stats?.totalTelegramUsers || 0}</div>
          <div className="stat-sub">Botga /start bosgan va muloqot qilganlar</div>
        </div>
      </div>

      <div className="quick-actions-section">
        <h3>Tezkor Amallar</h3>
        <div className="actions-grid">
          <Link to="/super-admin/shops" className="action-card">
            <div className="action-icon">🏪</div>
            <div className="action-info">
              <h4>Do'konlar & Obunalarni Boshqarish</h4>
              <p>Obunani uzaytirish, SMS paket berish va do'konlarni bloklash</p>
            </div>
          </Link>

          <Link to="/super-admin/broadcast" className="action-card">
            <div className="action-icon">📢</div>
            <div className="action-info">
              <h4>Tizim E'loni Yuborish (Broadcast)</h4>
              <p>Barcha do'kon egalariga xabarnoma yoki e'lon yuborish</p>
            </div>
          </Link>

          <Link to="/super-admin/plans" className="action-card">
            <div className="action-icon">💳</div>
            <div className="action-info">
              <h4>Tarif Rejalarini Sozlash</h4>
              <p>Limitlar, narxlar va SMS paketlarini tahrirlash</p>
            </div>
          </Link>

          <Link to="/super-admin/audit-log" className="action-card">
            <div className="action-icon">🛡</div>
            <div className="action-info">
              <h4>Faoliyat Jurnali (Audit Log)</h4>
              <p>Barcha administrator amallari tarixini ko'rish</p>
            </div>
          </Link>
        </div>
      </div>

      <div className="recent-logs-section">
        <div className="section-head">
          <h3>Oxirgi Administrator Harakatlari</h3>
          <Link to="/super-admin/audit-log" className="btn btn-sm btn-ghost">Barchasini ko'rish &rarr;</Link>
        </div>

        <div className="card">
          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>Vaqt</th>
                  <th>Ijrochi</th>
                  <th>Amal</th>
                  <th>Ma'lumot</th>
                </tr>
              </thead>
              <tbody>
                {recentLogs.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="empty-cell">Har qanday log yo'q</td>
                  </tr>
                ) : (
                  recentLogs.map((log) => (
                    <tr key={log.id}>
                      <td>{new Date(log.created_at).toLocaleString()}</td>
                      <td>{log.actor_phone || 'Admin'}</td>
                      <td><span className="badge badge-neutral">{log.action}</span></td>
                      <td><code>{JSON.stringify(log.meta)}</code></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
