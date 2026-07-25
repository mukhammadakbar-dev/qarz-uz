import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { fmtDate } from '../lib/format.js';
import { useToast } from '../components/Toast.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Modal from '../components/Modal.jsx';
import { Trash } from '../components/icons.jsx';
import './Staff.css';

export default function Staff() {
  const toast = useToast();
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [removeTarget, setRemoveTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.listStaff();
      setStaff(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setStaff([]);
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const toggleActive = async (member) => {
    setBusyId(member.id);
    try {
      await api.setStaffActive(member.id, !member.is_active);
      toast(member.is_active ? 'Xodim bloklandi' : 'Xodim faollashtirildi');
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    if (!removeTarget) return;
    setBusyId(removeTarget.id);
    try {
      await api.deleteStaff(removeTarget.id);
      toast("Xodim o'chirildi");
      setRemoveTarget(null);
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Xodimlar"
        subtitle="Do'koningizga qo'shimcha kirish huquqi bering"
        action={
          <button className="btn btn-primary" onClick={() => setAddOpen(true)}>
            + Xodim qo'shish
          </button>
        }
      />

      <div className="card" style={{ overflow: 'hidden' }}>
        {loading ? (
          <div className="list-loading"><span className="spinner" /></div>
        ) : staff.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">🧑‍💼</div>
            <p className="empty-title">Hali xodim yo'q</p>
            <p className="muted small">
              Xodimlar sizning nomingizdan mijoz qo'shishi va qarz yozishi mumkin.
            </p>
            <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => setAddOpen(true)}>
              + Xodim qo'shish
            </button>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Ism</th>
                <th>Telefon</th>
                <th>Qo'shilgan</th>
                <th>Holat</th>
                <th style={{ textAlign: 'center' }}>Amal</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((m) => (
                <tr key={m.id}>
                  <td className="cell-name">{m.full_name || '—'}</td>
                  <td className="muted num">{m.phone}</td>
                  <td className="muted small">{fmtDate(m.created_at)}</td>
                  <td>
                    <span className={`badge ${m.is_active ? 'badge-ok' : 'badge-danger'}`}>
                      {m.is_active ? 'Faol' : 'Bloklangan'}
                    </span>
                  </td>
                  <td>
                    <div className="row gap-8" style={{ justifyContent: 'center' }}>
                      <button
                        className="btn btn-mini"
                        disabled={busyId === m.id}
                        onClick={() => toggleActive(m)}
                      >
                        {busyId === m.id ? <span className="spinner" /> : m.is_active ? 'Bloklash' : 'Faollashtirish'}
                      </button>
                      <button
                        className="btn btn-icon btn-icon-danger"
                        disabled={busyId === m.id}
                        onClick={() => setRemoveTarget(m)}
                        aria-label="O'chirish"
                        title="O'chirish"
                      >
                        <Trash />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Yangi xodim">
        <AddStaffForm
          onDone={() => { setAddOpen(false); load(); toast('Xodim qo\'shildi'); }}
          onError={(m) => toast(m, 'error')}
        />
      </Modal>

      <Modal open={!!removeTarget} onClose={() => setRemoveTarget(null)} title="Xodimni o'chirish">
        {removeTarget && (
          <div>
            <p className="confirm-text">
              <b>{removeTarget.full_name || removeTarget.phone}</b> do'kondan olib tashlansinmi?
              U endi tizimga kira olmaydi.
            </p>
            <div className="row gap-8" style={{ marginTop: 16 }}>
              <button className="btn" onClick={() => setRemoveTarget(null)}>Bekor</button>
              <button className="btn btn-danger" style={{ flex: 1 }} onClick={remove} disabled={busyId === removeTarget.id}>
                {busyId === removeTarget.id ? <span className="spinner" /> : "O'chirish"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function AddStaffForm({ onDone, onError }) {
  const [form, setForm] = useState({ phone: '', password: '', fullName: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.createStaff({
        phone: form.phone,
        password: form.password,
        fullName: form.fullName || undefined,
      });
      onDone();
    } catch (err) {
      // Surface plan-limit errors clearly (422 PLAN_LIMIT_REACHED) rather than
      // a generic failure — the person needs to know *why* and what to do.
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label>Telefon raqam</label>
        <input className="input" type="tel" value={form.phone} onChange={set('phone')}
          placeholder="90 123 45 67" inputMode="tel" autoFocus required />
      </div>
      <div className="field">
        <label>Ism <span className="muted">(ixtiyoriy)</span></label>
        <input className="input" value={form.fullName} onChange={set('fullName')}
          placeholder="Ism familiya" />
      </div>
      <div className="field">
        <label>Vaqtinchalik parol</label>
        <input className="input" type="password" value={form.password} onChange={set('password')}
          placeholder="Kamida 6 belgi" minLength={6} required />
        <p className="muted small" style={{ marginTop: 6 }}>
          Xodim shu telefon va parol bilan veb-saytga yoki botga kiradi.
        </p>
      </div>
      <button className="btn btn-primary btn-block" disabled={busy} style={{ marginTop: 4 }}>
        {busy ? <span className="spinner" /> : 'Qo\'shish'}
      </button>
    </form>
  );
}
