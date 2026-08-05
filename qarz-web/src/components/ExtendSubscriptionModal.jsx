import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { som, fmtDate } from '../lib/format.js';
import Modal from './Modal.jsx';
import AmountInput from './AmountInput.jsx';
import { useToast } from './Toast.jsx';
import './ExtendSubscriptionModal.css';

const PLANS = [
  { code: 'start', label: 'Start' },
  { code: 'pro', label: 'Pro' },
  { code: 'business', label: 'Business' },
];

const MONTH_PRESETS = [1, 3, 6, 12];

/**
 * Records a subscription payment taken outside the system (cash, a card
 * transfer, whatever the owner and admin agreed) and extends the shop's period.
 *
 * This is the whole billing flow until Click is integrated, so the form leans
 * on suggesting the right number rather than trusting free entry: the amount is
 * prefilled from plan price x months, and the resulting expiry date is shown
 * before submitting.
 */
export default function ExtendSubscriptionModal({ shop, plans, onClose, onDone }) {
  const toast = useToast();
  const [plan, setPlan] = useState(shop?.plan || 'start');
  const [months, setMonths] = useState(1);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState(null);
  // Tracks whether the admin has typed over the suggestion, so recalculating it
  // never silently overwrites a deliberately different figure (a discount, a
  // part payment).
  const [amountTouched, setAmountTouched] = useState(false);

  const planPrice = plans?.find((p) => p.code === plan)?.price_uzs ?? 0;
  const suggested = planPrice * months;

  useEffect(() => {
    if (!amountTouched) setAmount(String(suggested));
  }, [suggested, amountTouched]);

  useEffect(() => {
    let cancelled = false;
    api
      .adminSubscriptionPayments(shop.id)
      .then((rows) => { if (!cancelled) setHistory(Array.isArray(rows) ? rows : []); })
      // History is context, not the point of the dialog — a failure here must
      // not block recording a payment.
      .catch(() => { if (!cancelled) setHistory([]); });
    return () => { cancelled = true; };
  }, [shop.id]);

  // Mirrors the server: extend from the current expiry when it is still in the
  // future, so paying early does not forfeit the days already bought.
  const base = shop.ends_at && new Date(shop.ends_at) > new Date()
    ? new Date(shop.ends_at)
    : new Date();
  const newEnd = new Date(base);
  newEnd.setMonth(newEnd.getMonth() + months);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.adminExtendSubscription(shop.id, {
        plan,
        months,
        amountUzs: Number(amount || 0),
        note: note.trim() || undefined,
      });
      toast(`${shop.name}: obuna ${fmtDate(res.endsAt)} gacha uzaytirildi`);
      onDone();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Obunani uzaytirish" width={520}>
      <form onSubmit={submit} className="ext-form">
        <div className="ext-shop">
          <strong>{shop.name}</strong>
          <span className="muted num">{shop.owner_phone}</span>
        </div>

        <div className="field">
          <label>Tarif</label>
          <div className="seg ext-seg">
            {PLANS.map((p) => (
              <button
                type="button"
                key={p.code}
                className={`seg-btn ${plan === p.code ? 'active' : ''}`}
                onClick={() => { setPlan(p.code); setAmountTouched(false); }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Muddat</label>
          <div className="seg ext-seg">
            {MONTH_PRESETS.map((m) => (
              <button
                type="button"
                key={m}
                className={`seg-btn ${months === m ? 'active' : ''}`}
                onClick={() => { setMonths(m); setAmountTouched(false); }}
              >
                {m} oy
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>
            Qabul qilingan summa
            {!amountTouched && suggested > 0 && (
              <span className="muted"> — taklif: {som(suggested)}</span>
            )}
          </label>
          <AmountInput
            value={amount}
            onChange={(v) => { setAmount(v); setAmountTouched(true); }}
          />
          <p className="muted small" style={{ marginTop: 6 }}>
            Bepul uzaytirish uchun 0 qoldiring — yozuv baribir saqlanadi.
          </p>
        </div>

        <div className="field">
          <label>Izoh <span className="muted">(ixtiyoriy)</span></label>
          <input
            className="input"
            value={note}
            maxLength={500}
            placeholder="Masalan: naqd, do'konda topshirdi"
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="ext-summary">
          <span className="muted">Yangi muddat</span>
          <strong>{fmtDate(newEnd)}</strong>
          {shop.ends_at && new Date(shop.ends_at) > new Date() && (
            <span className="muted small">
              ({fmtDate(shop.ends_at)} dan davom etadi)
            </span>
          )}
        </div>

        <div className="ext-actions">
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Bekor qilish
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? <span className="spinner" /> : 'Tasdiqlash'}
          </button>
        </div>
      </form>

      {history !== null && history.length > 0 && (
        <div className="ext-history">
          <div className="ext-history-title">Oldingi to'lovlar</div>
          <ul>
            {history.slice(0, 5).map((h) => (
              <li key={h.id}>
                <span className="num">{som(h.amount_uzs)}</span>
                <span className="muted small">
                  {h.plan} · {h.months} oy · {fmtDate(h.created_at)}
                </span>
                {h.note && <span className="muted small ext-note">{h.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
