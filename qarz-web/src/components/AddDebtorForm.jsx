import { useState } from 'react';
import { api } from '../lib/api.js';

export default function AddDebtorForm({ onDone, onError }) {
  const [form, setForm] = useState({ fullName: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.createDebtor({
        fullName: form.fullName,
        phone: form.phone || undefined,
      });
      onDone();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label>Ism familiya</label>
        <input className="input" value={form.fullName} onChange={set('fullName')}
          placeholder="Masalan: Akmal Yusupov" required autoFocus />
      </div>
      <div className="field">
        <label>Telefon <span className="muted">(ixtiyoriy)</span></label>
        <input className="input" value={form.phone} onChange={set('phone')}
          placeholder="90 123 45 67" inputMode="tel" />
        <p className="muted small" style={{ marginTop: 6 }}>
          Telefon orqali mijoz bildirishnoma va to'lov linkini oladi.
        </p>
      </div>
      <button className="btn btn-primary btn-block" disabled={busy} style={{ marginTop: 4 }}>
        {busy ? <span className="spinner" /> : 'Saqlash'}
      </button>
    </form>
  );
}
