import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { grp, fmtDate, todayISO, parseInputAmount } from '../lib/format.js';
import AmountInput from '../components/AmountInput.jsx';
import { useToast } from '../components/Toast.jsx';
import PageHeader from '../components/PageHeader.jsx';
import './Sales.css';

export default function Sales() {
  const toast = useToast();
  const [date, setDate] = useState(todayISO());
  const [cash, setCash] = useState('');
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const from = new Date(Date.now() - 13 * 864e5).toISOString().slice(0, 10);
      const data = await api.salesRange(from);
      setRows(Array.isArray(data) ? [...data].reverse() : []); // newest first
    } catch (err) {
      setRows([]);
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const save = async (e) => {
    e.preventDefault();
    const val = parseInputAmount(cash);
    if (!(val >= 0) || cash === '') return toast('Summani kiriting', 'error');
    setBusy(true);
    try {
      const r = await api.saveDailySales(val, date);
      toast(`Saqlandi — jami ${grp(r.total)} so'm`);
      setCash('');
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Kunlik savdo" subtitle="Naqd/karta savdoni kiriting — qarzga berilgani avtomatik qo'shiladi" />

      <div className="sales-grid">
        <form className="card sales-form" onSubmit={save}>
          <h2 className="sales-form-title">Savdo kiritish</h2>
          <div className="field">
            <label>Sana</label>
            <input className="input" type="date" value={date} max={todayISO()}
              onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label>Naqd / karta savdo</label>
            <AmountInput value={cash} onChange={setCash} placeholder="1 200 000" autoFocus />
          </div>
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? <span className="spinner" /> : 'Saqlash'}
          </button>
          <p className="muted small sales-hint">
            Jami aylanma = naqd/karta + shu kuni yozilgan qarzlar. Qarzlar tizim tomonidan avtomatik qo'shiladi.
          </p>
        </form>

        <div className="card sales-history">
          <div className="sales-hist-head">So'nggi 14 kun</div>
          {loading ? (
            <div className="list-loading"><span className="spinner" /></div>
          ) : rows.length === 0 ? (
            <p className="muted small" style={{ padding: 20, textAlign: 'center' }}>
              Hali yozuv yo'q.
            </p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Sana</th>
                  <th style={{ textAlign: 'right' }}>Naqd/karta</th>
                  <th style={{ textAlign: 'right' }}>Qarz</th>
                  <th style={{ textAlign: 'right' }}>Jami</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.sale_date}>
                    <td>{fmtDate(r.sale_date)}</td>
                    <td style={{ textAlign: 'right' }} className="num">{grp(r.cash_card)}</td>
                    <td style={{ textAlign: 'right' }} className="num accent-num">{grp(r.debt_given)}</td>
                    <td style={{ textAlign: 'right' }} className="mono-amt">{grp(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
