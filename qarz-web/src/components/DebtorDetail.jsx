import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { som, grp, fmtDate, statusMeta, todayISO, parseInputAmount } from '../lib/format.js';
import { useAuth } from '../lib/auth.jsx';
import AmountInput from './AmountInput.jsx';
import { Pencil, Trash } from './icons.jsx';
import './DebtorDetail.css';

export default function DebtorDetail({ debtor, onChanged, notify, onClose }) {
  const { user } = useAuth();
  const isPersonal = user?.role === 'personal';
  const [debts, setDebts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('list'); // 'list' | 'add' | 'pay' | 'edit' | 'confirmDelete'
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

  const outstandingGiven = debts.reduce(
    (s, d) => s + (d.status !== 'paid' && d.direction !== 'taken' ? Number(d.amount) - Number(d.paid_amount) : 0), 0
  );
  const outstandingTaken = debts.reduce(
    (s, d) => s + (d.status !== 'paid' && d.direction === 'taken' ? Number(d.amount) - Number(d.paid_amount) : 0), 0
  );
  const outstanding = outstandingGiven + outstandingTaken; // shop_owner/staff: always 'given' only

  const refresh = () => { load(); onChanged?.(); };

  if (view === 'add') {
    return <AddDebt debtorId={debtor.id} notify={notify} isPersonal={isPersonal}
      onCancel={() => setView('list')}
      onDone={() => { setView('list'); refresh(); notify('Qarz yozildi'); }} />;
  }
  if (view === 'pay' && payTarget) {
    return <PayDebt debt={payTarget} notify={notify}
      onCancel={() => setView('list')}
      onDone={() => { setView('list'); refresh(); notify('To\'lov qayd etildi'); }} />;
  }
  if (view === 'edit') {
    return <EditDebtor debtor={debtor} notify={notify}
      onCancel={() => setView('list')}
      onDone={(updated) => { setView('list'); onChanged?.(updated); notify('Mijoz yangilandi'); }} />;
  }
  if (view === 'confirmDelete') {
    return <ConfirmDelete debtor={debtor} notify={notify}
      onCancel={() => setView('list')}
      onDone={() => { onChanged?.(); onClose?.(); notify('Mijoz arxivlandi'); }} />;
  }

  return (
    <div>
      <div className="dd-summary">
        {isPersonal ? (
          <div className="dd-split">
            <div>
              <div className="muted small">Menga qarzdor</div>
              <div className="dd-out mono-amt amt-due">{som(outstandingGiven)}</div>
            </div>
            <div>
              <div className="muted small">Men qarzdorman</div>
              <div className="dd-out mono-amt amt-owe">{som(outstandingTaken)}</div>
            </div>
          </div>
        ) : (
          <div>
            <div className="muted small">Qoldiq qarz</div>
            <div className="dd-out mono-amt">{som(outstanding)}</div>
          </div>
        )}
        {debtor.phone && <div className="dd-phone muted num">{debtor.phone}</div>}
        <div className="dd-head-actions">
          <button className="btn btn-icon" onClick={() => setView('edit')}
            aria-label="Tahrirlash" title="Tahrirlash"><Pencil /></button>
          <button className="btn btn-icon btn-icon-danger" onClick={() => setView('confirmDelete')}
            aria-label="O'chirish" title="O'chirish"><Trash /></button>
          <button className="btn btn-primary" onClick={() => setView('add')}>+ Qarz yozish</button>
        </div>
      </div>

      {loading ? (
        <div className="list-loading"><span className="spinner" /></div>
      ) : debts.length === 0 ? (
        <p className="muted small dd-empty">Hali qarz yozuvi yo'q.</p>
      ) : (
        <div className="dd-list">
          {debts.map((d) => {
            const meta = statusMeta[d.status] || statusMeta.open;
            return (
              <div key={d.id} className="dd-item">
                <div className="dd-item-main">
                  <div className="row between">
                    <span className="mono-amt">{som(d.amount)}</span>
                    <div className="row gap-8">
                      {isPersonal && (
                        <span className={`badge ${d.direction === 'taken' ? 'badge-warn' : 'badge-neutral'}`}>
                          {d.direction === 'taken' ? 'Men qarzdorman' : 'Menga qarzdor'}
                        </span>
                      )}
                      <span className={`badge ${meta.cls}`}>{meta.label}</span>
                    </div>
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
  let url;
  try {
    ({ url } = await api.paymentLink(debtId));
  } catch (err) {
    return notify(err.message, 'error');
  }
  // navigator.clipboard is undefined outside a secure context (plain http),
  // where the old code threw a TypeError that surfaced as a link-creation
  // failure — even though the link had in fact been created. Show it instead.
  try {
    await navigator.clipboard.writeText(url);
    notify('To\'lov linki nusxalandi');
  } catch {
    notify(`To'lov linki: ${url}`);
  }
};

function AddDebt({ debtorId, onDone, onCancel, notify, isPersonal }) {
  const [form, setForm] = useState({ amount: '', dueDate: '', note: '', direction: 'given' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const amount = parseInputAmount(form.amount);
    if (!(amount > 0)) return notify('To\'g\'ri summa kiriting', 'error');
    setBusy(true);
    try {
      await api.addDebt({
        debtorId, direction: isPersonal ? form.direction : 'given', amount,
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
      {isPersonal && (
        <div className="field">
          <label>Yozuv turi</label>
          <div className="seg seg-full">
            <button type="button" className={`seg-btn ${form.direction === 'given' ? 'active' : ''}`}
              onClick={() => setForm((f) => ({ ...f, direction: 'given' }))}>
              Menga qarzdor
            </button>
            <button type="button" className={`seg-btn ${form.direction === 'taken' ? 'active' : ''}`}
              onClick={() => setForm((f) => ({ ...f, direction: 'taken' }))}>
              Men qarzdorman
            </button>
          </div>
        </div>
      )}
      <div className="field">
        <label>Summa</label>
        <AmountInput
          value={form.amount}
          onChange={(digits) => setForm((f) => ({ ...f, amount: digits }))}
          placeholder="50 000"
          autoFocus
          required
        />
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
    const val = parseInputAmount(amount);
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
        <AmountInput value={amount} onChange={setAmount} autoFocus required />
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

// Mirrors the backend rule so users get instant feedback instead of a round trip.
const NAME_RE = /^[A-Za-zА-Яа-яЁёЎўҚқҒғҲҳÀ-ÿʻʼ'’\-\s.]+$/u;
const PHONE_RE = /^[\d\s()+-]{7,20}$/;

export function validateDebtorFields({ fullName, phone, requireContact = true }) {
  if (!fullName || fullName.trim().length < 2) return "Ism kamida 2 belgidan iborat bo'lishi kerak";
  if (!NAME_RE.test(fullName.trim())) return "Ism faqat harflardan iborat bo'lishi kerak";
  if (phone && !PHONE_RE.test(phone.trim())) return 'Telefon raqami faqat raqamlardan iborat bo\'lishi kerak';
  if (requireContact && !phone) return 'Telefon raqamini kiriting';
  return null;
}

function EditDebtor({ debtor, onDone, onCancel, notify }) {
  const [form, setForm] = useState({
    fullName: debtor.full_name || '',
    phone: debtor.phone || '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErr(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    const problem = validateDebtorFields({
      fullName: form.fullName,
      phone: form.phone,
      requireContact: debtor.telegram_id == null,
    });
    if (problem) { setErr(problem); return; }

    setBusy(true);
    try {
      const updated = await api.updateDebtor(debtor.id, {
        fullName: form.fullName.trim(),
        phone: form.phone.trim() || null,
      });
      onDone(updated);
    } catch (e2) {
      notify(e2.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="subform">
      <div className="field">
        <label>Ism familiya</label>
        <input className="input" value={form.fullName} onChange={set('fullName')} autoFocus required />
      </div>
      <div className="field">
        <label>Telefon</label>
        <input className="input" type="tel" value={form.phone} onChange={set('phone')}
          placeholder="90 123 45 67" inputMode="tel" />
      </div>
      {err && <p className="field-error">{err}</p>}
      <div className="row gap-8">
        <button type="button" className="btn" onClick={onCancel}>Bekor</button>
        <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy}>
          {busy ? <span className="spinner" /> : 'Saqlash'}
        </button>
      </div>
    </form>
  );
}

function ConfirmDelete({ debtor, onDone, onCancel, notify }) {
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteDebtor(debtor.id);
      onDone();
    } catch (err) {
      // Most common case: the debtor still has unpaid debts (409 HAS_OPEN_DEBTS)
      notify(err.message, 'error');
      onCancel();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="subform">
      <p className="confirm-text">
        <b>{debtor.full_name}</b> arxivlansinmi? Mijoz ro'yxatdan yashiriladi,
        lekin qarz tarixi saqlanib qoladi.
      </p>
      <p className="muted small" style={{ marginBottom: 16 }}>
        To'lanmagan qarzi bo'lsa, arxivlash rad etiladi.
      </p>
      <div className="row gap-8">
        <button type="button" className="btn" onClick={onCancel}>Bekor</button>
        <button className="btn btn-danger" style={{ flex: 1 }} onClick={remove} disabled={busy}>
          {busy ? <span className="spinner" /> : 'Arxivlash'}
        </button>
      </div>
    </div>
  );
}
