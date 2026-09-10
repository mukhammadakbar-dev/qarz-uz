import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { som, grp, fmtDate } from '../lib/format.js';
import { useToast } from '../components/Toast.jsx';
import PageHeader from '../components/PageHeader.jsx';
import ExtendSubscriptionModal from '../components/ExtendSubscriptionModal.jsx';
import './SuperAdminShops.css';

const STATUS_LABEL = {
  trial: { label: 'Sinov', cls: 'badge-neutral' },
  active: { label: 'Faol', cls: 'badge-ok' },
  expired: { label: 'Muddati tugagan', cls: 'badge-danger' },
  blocked: { label: 'Bloklangan', cls: 'badge-danger' },
};

function AddSmsModal({ shop, onClose, onDone }) {
  const [amount, setAmount] = useState('50');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async (e) => {
    e.preventDefault();
    const val = parseInt(amount, 10);
    if (!val || val <= 0) {
      toast('SMS sonini to\'g\'ri kiriting', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.adminAddSmsQuota(shop.id, val);
      toast(`✅ ${shop.name} do'koniga ${val} ta SMS qo'shildi`);
      onDone();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px', padding: '24px' }}>
        <h3>SMS Paket Qo'shish</h3>
        <p className="muted" style={{ fontSize: '13px', marginBottom: '16px' }}>
          <b>{shop.name}</b> do'koniga bonus SMS limiti berish
        </p>

        <form onSubmit={submit}>
          <div className="field" style={{ marginBottom: '16px' }}>
            <label>SMS soni</label>
            <input
              type="number"
              className="input"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min="1"
              required
            />
          </div>

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Bekor qilish</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Qo\'shilmoqda...' : 'SMS Qo\'shish'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function SuperAdminShops() {
  const toast = useToast();
  const [stats, setStats] = useState(null);
  const [shops, setShops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [extending, setExtending] = useState(null);
  const [addingSms, setAddingSms] = useState(null);
  const [plans, setPlans] = useState([]);

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

  useEffect(() => {
    api.adminPlans().then((p) => setPlans(Array.isArray(p) ? p : [])).catch(() => setPlans([]));
  }, []);

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
      <PageHeader title="Do'konlar & Foydalanuvchilar" subtitle="Platformadagi barcha do'konlar va ularning obuna/SMS holati" />

      <div className="stat-grid sa-stat-grid">
        <MiniStat label="Jami do'konlar" value={stats ? grp(stats.totalShops) : '—'} />
        <MiniStat label="Faol obunalar" value={stats ? grp(stats.activeSubscriptions) : '—'} />
        <MiniStat label="SMS (shu oy)" value={stats ? grp(stats.smsThisMonth) : '—'} />
        <MiniStat label="Bu oy tushdi" value={stats ? som(stats.collectedThisMonth) : '—'} />
      </div>

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
          {[['', 'Hammasi'], ['trial', 'Sinov'], ['active', 'Faol'], ['expired', 'Tugagan'], ['blocked', 'Bloklangan']].map(([k, l]) => (
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
                <th>Qarzdorlar / Qarz</th>
                <th style={{ textAlign: 'right' }}>SMS Balans</th>
                <th>Amallar</th>
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
                    <td className="muted small">
                      {grp(s.debtor_count || 0)} ta / {som(s.total_outstanding || 0)}
                    </td>
                    <td style={{ textAlign: 'right' }} className="num muted">{grp(s.sms_remaining ?? 0)}</td>
                    <td>
                      <div className="sa-actions" style={{ display: 'flex', gap: '6px' }}>
                        <button className="btn btn-mini" onClick={() => setExtending(s)}>
                          Uzaytirish
                        </button>
                        <button className="btn btn-mini btn-outline" onClick={() => setAddingSms(s)}>
                          +SMS
                        </button>
                        <button
                          className={`btn btn-mini ${s.is_active ? 'btn-mini-danger' : ''}`}
                          disabled={busyId === s.id}
                          onClick={() => toggleActive(s)}
                        >
                          {busyId === s.id ? <span className="spinner" /> : s.is_active ? 'Bloklash' : 'Faollashtirish'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {extending && (
        <ExtendSubscriptionModal
          shop={extending}
          plans={plans}
          onClose={() => setExtending(null)}
          onDone={() => { setExtending(null); load(); }}
        />
      )}

      {addingSms && (
        <AddSmsModal
          shop={addingSms}
          onClose={() => setAddingSms(null)}
          onDone={() => { setAddingSms(null); load(); }}
        />
      )}
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
