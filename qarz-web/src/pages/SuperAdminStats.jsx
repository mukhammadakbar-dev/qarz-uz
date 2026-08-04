import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { grp } from '../lib/format.js';
import { useToast } from '../components/Toast.jsx';
import PageHeader from '../components/PageHeader.jsx';

export default function SuperAdminStats() {
  const toast = useToast();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.adminStats()
      .then((data) => setStats(data))
      .catch((err) => toast(err.message, 'error'))
      .finally(() => setLoading(false));
  }, [toast]);

  if (loading) {
    return (
      <div className="super-admin-page">
        <PageHeader title="Platforma Statistikasi" subtitle="Platforma bo'yicha ko'rsatkichlar" />
        <div className="card text-center" style={{ padding: 40 }}>
          <span className="spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="super-admin-page">
      <PageHeader title="Platforma Statistikasi" subtitle="Platforma bo'yicha ko'rsatkichlar va daromad" />

      <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div className="card stat-card">
          <div className="stat-label muted">Jami do'konlar</div>
          <div className="stat-val text-lg bold">{stats?.totalShops ?? 0}</div>
        </div>

        <div className="card stat-card">
          <div className="stat-label muted">Faol obunalar</div>
          <div className="stat-val text-lg bold text-success">{stats?.activeSubscriptions ?? 0}</div>
        </div>

        <div className="card stat-card">
          <div className="stat-label muted">Oylik daromad (MRR)</div>
          <div className="stat-val text-lg bold text-primary">{grp(stats?.mrr || 0)} UZS</div>
        </div>

        <div className="card stat-card">
          <div className="stat-label muted">Qolgan SMS balansi</div>
          <div className="stat-val text-lg bold">{stats?.totalSmsRemaining ?? 0}</div>
        </div>
      </div>
    </div>
  );
}
