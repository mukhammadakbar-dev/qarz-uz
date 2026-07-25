import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { som } from '../lib/format.js';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../components/Toast.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Modal from '../components/Modal.jsx';
import DebtorDetail from '../components/DebtorDetail.jsx';
import AddDebtorForm from '../components/AddDebtorForm.jsx';
import './Debtors.css';

const FILTERS = [
  { key: 'all', label: 'Hammasi' },
  { key: 'with_debt', label: 'Qarzdorlar' },
  { key: 'no_debt', label: 'Qarzsiz' },
];

export default function Debtors() {
  const toast = useToast();
  const { user } = useAuth();
  const isPersonal = user?.role === 'personal';
  const [debtors, setDebtors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.listDebtors({ search: search || undefined, filter });
      // the API should return an array; guard so a malformed response
      // can't crash the page with `rows.map is not a function`
      setDebtors(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setDebtors([]);
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [search, filter, toast]);

  useEffect(() => {
    const id = setTimeout(load, search ? 300 : 0); // debounce search
    return () => clearTimeout(id);
  }, [load, search]);

  return (
    <>
      <PageHeader
        title="Qarzdorlar"
        subtitle="Mijozlar va ularning qarzlari"
        action={
          <button className="btn btn-primary" onClick={() => setAddOpen(true)}>
            + Mijoz qo'shish
          </button>
        }
      />

      <div className="toolbar card">
        <div className="search-box">
          <SearchIcon />
          <input
            className="search-input"
            placeholder="Ism yoki telefon bo'yicha qidirish"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="seg">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`seg-btn ${filter === f.key ? 'active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        {loading ? (
          <div className="list-loading"><span className="spinner" /></div>
        ) : debtors.length === 0 ? (
          <EmptyState onAdd={() => setAddOpen(true)} hasSearch={!!search} />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Mijoz</th>
                <th>Telefon</th>
                {isPersonal ? (
                  <>
                    <th style={{ textAlign: 'right' }}>Menga qarzdor</th>
                    <th style={{ textAlign: 'right' }}>Men qarzdorman</th>
                  </>
                ) : (
                  <th style={{ textAlign: 'right' }}>Qoldiq qarz</th>
                )}
                <th style={{ textAlign: 'center', width: 90 }}>Yozuvlar</th>
              </tr>
            </thead>
            <tbody>
              {debtors.map((d) => (
                <tr key={d.id} className="clickable" onClick={() => setSelected(d)}>
                  <td>
                    <div className="cell-name">
                      <span className="avatar">{initials(d.full_name)}</span>
                      {d.full_name}
                    </div>
                  </td>
                  <td className="muted num">{d.phone || '—'}</td>
                  {isPersonal ? (
                    <>
                      <td style={{ textAlign: 'right' }}>
                        <span className={`mono-amt ${Number(d.outstanding_given) > 0 ? 'amt-due' : 'muted'}`}>
                          {som(d.outstanding_given)}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span className={`mono-amt ${Number(d.outstanding_taken) > 0 ? 'amt-owe' : 'muted'}`}>
                          {som(d.outstanding_taken)}
                        </span>
                      </td>
                    </>
                  ) : (
                    <td style={{ textAlign: 'right' }}>
                      <span className={`mono-amt ${Number(d.outstanding) > 0 ? 'amt-due' : 'muted'}`}>
                        {som(d.outstanding)}
                      </span>
                    </td>
                  )}
                  <td style={{ textAlign: 'center' }} className="muted num">{d.debt_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Yangi mijoz">
        <AddDebtorForm
          onDone={() => { setAddOpen(false); load(); toast('Mijoz qo\'shildi'); }}
          onError={(m) => toast(m, 'error')}
        />
      </Modal>

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.full_name || ''}
        width={560}
      >
        {selected && (
          <DebtorDetail
            debtor={selected}
            onChanged={(updated) => {
              if (updated) setSelected((s) => (s ? { ...s, ...updated } : s));
              load();
            }}
            notify={toast}
            onClose={() => setSelected(null)}
          />
        )}
      </Modal>
    </>
  );
}

const initials = (name) =>
  (name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

function EmptyState({ onAdd, hasSearch }) {
  return (
    <div className="empty">
      <div className="empty-icon">👥</div>
      <p className="empty-title">
        {hasSearch ? 'Hech narsa topilmadi' : 'Hali mijozlar yo\'q'}
      </p>
      <p className="muted small">
        {hasSearch ? 'Boshqa so\'z bilan qidirib ko\'ring.' : 'Birinchi mijozingizni qo\'shing va qarz yozing.'}
      </p>
      {!hasSearch && <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={onAdd}>+ Mijoz qo'shish</button>}
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
