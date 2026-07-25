import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { som, grp, fmtDate } from '../lib/format.js';
import { useToast } from '../components/Toast.jsx';
import PageHeader from '../components/PageHeader.jsx';
import BroadcastCard from '../components/BroadcastCard.jsx';
import './SuperAdminShops.css';

const STATUS_LABEL = {
  trial: { label: 'Sinov', cls: 'badge-neutral' },
  active: { label: 'Faol', cls: 'badge-ok' },
  expired: { label: 'Muddati tugagan', cls: 'badge-danger' },
  blocked: { label: 'Bloklangan', cls: 'badge-danger' },
};

export default function SuperAdminShops() {
  const toast = useToast();
  const [stats, setStats] = useState(null);
  const [shops, setShops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, list] = await Promise.all([
        api.adminStats(),
        api.adminShops({ search: search || undefined, status: status || undefined }),
      ]);
      setStats(s);
      setShops(Array.isArray(list) ? list : []);
    } catch (err) {
      setShops([]);
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [search, status, toast]);

  useEffect(() => {
    const id = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(id);
  }, [load, search]);

  const toggleActive = async (shop) => {
    setBusyId(shop.id);
    try {
      await api.adminSetShopActive(shop.id, !shop.is_active);
      toast(shop.is_active ? "Do'kon bloklandi" : "Do'kon faollashtirildi");
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PageHeader title="Do'konlar" subtitle="Platformadagi barcha do'konlar va obunalar" />

      <div className="stat-grid sa-stat-grid">
        <MiniStat label="Jami do'konlar" value={stats ? grp(stats.totalShops) : '—'} />
        <MiniStat label="Faol obunalar" value={stats ? grp(stats.activeSubscriptions) : '—'} />
        <MiniStat label="SMS (shu oy)" value={stats ? grp(stats.smsThisMonth) : '—'} />
        <MiniStat label="Oylik daromad" value={stats ? som(stats.monthlyRecurringRevenue) : '—'} />
      </div>

      <BroadcastCard />

      <div className="toolbar card">
        <div className="search-box">
          <SearchIcon />
          <input
            className="search-input"
            placeholder="Do'kon nomi yoki telefon bo'yicha qidirish"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="seg">
          {[['', 'Hammasi'], ['trial', 'Sinov'], ['active', 'Faol'], ['expired', 'Tugagan']].map(([k, l]) => (
            <button key={k} className={`seg-btn ${status === k ? 'active' : ''}`} onClick={() => setStatus(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        {loading ? (
          <div className="list-loading"><span className="spinner" /></div>
        ) : shops.length === 0 ? (
          <div className="empty">
            <p className="empty-title">Hech narsa topilmadi</p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Do'kon</th>
                <th>Egasi</th>
                <th>Tarif</th>
                <th>Holat</th>
                <th>Muddati</th>
                <th style={{ textAlign: 'right' }}>SMS</th>
                <th style={{ textAlign: 'center' }}>Amal</th>
              </tr>
            </thead>
            <tbody>
              {shops.map((s) => {
                const meta = STATUS_LABEL[s.status] || STATUS_LABEL.trial;
                return (
                  <tr key={s.id}>
                    <td className="cell-name">{s.name}</td>
                    <td className="muted num">{s.owner_phone}</td>
                    <td className="muted">{s.plan || '—'}</td>
                    <td><span className={`badge ${meta.cls}`}>{meta.label}</span></td>
                    <td className="muted small">{s.ends_at ? fmtDate(s.ends_at) : '—'}</td>
                    <td style={{ textAlign: 'right' }} className="num muted">{grp(s.sms_remaining ?? 0)}</td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        className={`btn btn-mini ${s.is_active ? 'btn-mini-danger' : ''}`}
                        disabled={busyId === s.id}
                        onClick={() => toggleActive(s)}
                      >
                        {busyId === s.id ? <span className="spinner" /> : s.is_active ? 'Bloklash' : 'Faollashtirish'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="card stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value num tone-ink" style={{ fontSize: 19 }}>{value}</div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" strokeLinecap="round" />
    </svg>
  );
}
