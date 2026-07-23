import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { som, grp, fmtDate, statusMeta, todayISO } from '../lib/format.js';
import './DebtorDetail.css';

export default function DebtorDetail({ debtor, onChanged, notify }) {
  const [debts, setDebts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('list'); // 'list' | 'add' | 'pay'
  const [payTarget, setPayTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.debtorHistory(debtor.id);
      setDebts(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setDebts([]);
      notify(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [debtor.id, notify]);

  useEffect(() => { load(); }, [load]);

  const outstanding = debts.reduce(
    (s, d) => s + (d.status !== 'paid' ? Number(d.amount) - Number(d.paid_amount) : 0), 0
  );

  const refresh = () => { load(); onChanged?.(); };

  if (view === 'add') {
    return <AddDebt debtorId={debtor.id} notify={notify}
      onCancel={() => setView('list')}
      onDone={() => { setView('list'); refresh(); notify('Qarz yozildi'); }} />;
  }
  if (view === 'pay' && payTarget) {
    return <PayDebt debt={payTarget} notify={notify}
      onCancel={() => setView('list')}
      onDone={() => { setView('list'); refresh(); notify('To\'lov qayd etildi'); }} />;
  }

  return (
    <div>
      <div className="dd-summary">
        <div>
          <div className="muted small">Qoldiq qarz</div>
          <div className="dd-out mono-amt">{som(outstanding)}</div>
        </div>
        {debtor.phone && <div className="dd-phone muted num">{debtor.phone}</div>}
        <button className="btn btn-primary" onClick={() => setView('add')}>+ Qarz yozish</button>
      </div>

      {loading ? (
        <div className="list-loading"><span className="spinner" /></div>
      ) : debts.length === 0 ? (
        <p className="muted small dd-empty">Hali qarz yozuvi yo'q.</p>
      ) : (
        <div className="dd-list">
          {debts.map((d) => {
            const left = Number(d.amount) - Number(d.paid_amount);
            const meta = statusMeta[d.status] || statusMeta.open;
            return (
              <div key={d.id} className="dd-item">
                <div className="dd-item-main">
                  <div className="row between">
                    <span className="mono-amt">{som(d.amount)}</span>
                    <span className={`badge ${meta.cls}`}>{meta.label}</span>
                  </div>
                  <div className="dd-item-meta muted small">
                    {fmtDate(d.issued_at)}
                    {d.due_date && <> · muddat {fmtDate(d.due_date)}</>}
                    {Number(d.paid_amount) > 0 && <> · to'landi {grp(d.paid_amount)}</>}
                  </div>
                  {d.note && <div className="dd-note small">{d.note}</div>}
                </div>
                {d.status !== 'paid' && (
                  <div className="dd-actions">
                    <button className="btn btn-mini" onClick={() => { setPayTarget(d); setView('pay'); }}>
                      To'lov
                    </button>
                    <button className="btn btn-mini" onClick={() => makeLink(d.id, notify)}>
                      Link
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const makeLink = async (debtId, notify) => {
  try {
    const { url } = await api.paymentLink(debtId);
    await navigator.clipboard.writeText(url).catch(() => {});
    notify('To\'lov linki nusxalandi');
  } catch (err) {
    notify(err.message, 'error');
  }
};

function AddDebt({ debtorId, onDone, onCancel, notify }) {
  const [form, setForm] = useState({ amount: '', dueDate: '', note: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const amount = Number(String(form.amount).replace(/[^\d.]/g, ''));
    if (!(amount > 0)) return notify('To\'g\'ri summa kiriting', 'error');
    setBusy(true);
    try {
      await api.addDebt({
        debtorId, direction: 'given', amount,
        dueDate: form.dueDate || undefined,
        note: form.note || undefined,
      });
      onDone();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="subform">
      <div className="field">
        <label>Summa (so'm)</label>
        <input className="input" value={form.amount} onChange={set('amount')}
          placeholder="50 000" inputMode="numeric" autoFocus required />
      </div>
      <div className="field">
        <label>Qaytarish muddati <span className="muted">(ixtiyoriy)</span></label>
        <input className="input" type="date" value={form.dueDate} onChange={set('dueDate')} min={todayISO()} />
      </div>
      <div className="field">
        <label>Izoh <span className="muted">(ixtiyoriy)</span></label>
        <textarea className="input" value={form.note} onChange={set('note')} placeholder="Masalan: un-yog' uchun" />
      </div>
      <div className="row gap-8">
        <button type="button" className="btn" onClick={onCancel}>Bekor</button>
        <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy}>
          {busy ? <span className="spinner" /> : 'Qarz yozish'}
        </button>
      </div>
    </form>
  );
}

function PayDebt({ debt, onDone, onCancel, notify }) {
  const left = Number(debt.amount) - Number(debt.paid_amount);
  const [amount, setAmount] = useState(String(Math.round(left)));
  const [method, setMethod] = useState('cash');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const val = Number(String(amount).replace(/[^\d.]/g, ''));
    if (!(val > 0) || val > left + 0.001) return notify('Summa qoldiqdan oshmasligi kerak', 'error');
    setBusy(true);
    try {
      await api.payDebt(debt.id, { amount: val, method });
      onDone();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="subform">
      <div className="pay-note muted small">Qoldiq: <b className="num">{som(left)}</b></div>
      <div className="field">
        <label>To'lov summasi</label>
        <input className="input" value={amount} onChange={(e) => setAmount(e.target.value)}
          inputMode="numeric" autoFocus required />
      </div>
      <div className="field">
        <label>Usul</label>
        <div className="seg seg-full">
          {[['cash', 'Naqd'], ['click', 'Click'], ['manual', 'Boshqa']].map(([k, l]) => (
            <button type="button" key={k} className={`seg-btn ${method === k ? 'active' : ''}`}
              onClick={() => setMethod(k)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="row gap-8">
        <button type="button" className="btn" onClick={onCancel}>Bekor</button>
        <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy}>
          {busy ? <span className="spinner" /> : 'To\'lovni qayd etish'}
        </button>
      </div>
    </form>
  );
}
