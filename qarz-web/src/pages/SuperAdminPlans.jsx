import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { parseInputAmount } from '../lib/format.js';
import AmountInput from '../components/AmountInput.jsx';
import { useToast } from '../components/Toast.jsx';
import PageHeader from '../components/PageHeader.jsx';
import './SuperAdminPlans.css';

export default function SuperAdminPlans() {
  const toast = useToast();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.adminPlans();
      setPlans(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setPlans([]);
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <PageHeader title="Tariflar" subtitle="Narx va limitlarni tahrirlash" />
      {loading ? (
        <div className="list-loading"><span className="spinner" /></div>
      ) : (
        <div className="plans-grid">
          {plans.map((p) => (
            <PlanCard key={p.code} plan={p} onSaved={load} notify={toast} />
          ))}
        </div>
      )}
    </>
  );
}

function PlanCard({ plan, onSaved, notify }) {
  const [form, setForm] = useState({
    name: plan.name,
    priceUzs: String(plan.price_uzs ?? ''),
    maxDebtors: plan.max_debtors == null ? '' : String(plan.max_debtors),
    unlimited: plan.max_debtors == null,
    maxStaff: String(plan.max_staff ?? 0),
    monthlySms: String(plan.monthly_sms ?? 0),
    advancedStats: !!plan.advanced_stats,
  });
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.adminUpdatePlan(plan.code, {
        name: form.name,
        priceUzs: parseInputAmount(form.priceUzs) || 0,
        maxDebtors: form.unlimited ? null : (Number(form.maxDebtors) || 0),
        maxStaff: Number(form.maxStaff) || 0,
        monthlySms: Number(form.monthlySms) || 0,
        advancedStats: form.advancedStats,
      });
      notify(`"${form.name}" saqlandi`);
      onSaved();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card plan-card" onSubmit={save}>
      <div className="plan-head">
        <input
          className="input plan-name-input"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
        <span className="plan-code">{plan.code}</span>
      </div>

      <div className="field">
        <label>Narx (oylik)</label>
        <AmountInput
          value={form.priceUzs}
          onChange={(v) => setForm((f) => ({ ...f, priceUzs: v }))}
        />
      </div>

      <div className="field">
        <label>Mijozlar limiti</label>
        <div className="plan-limit-row">
          <input
            className="input"
            type="number"
            min="0"
            value={form.maxDebtors}
            disabled={form.unlimited}
            onChange={(e) => setForm((f) => ({ ...f, maxDebtors: e.target.value }))}
          />
          <label className="plan-unlimited">
            <input
              type="checkbox"
              checked={form.unlimited}
              onChange={(e) => setForm((f) => ({ ...f, unlimited: e.target.checked }))}
            />
            Cheksiz
          </label>
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label>Xodimlar</label>
          <input className="input" type="number" min="0" value={form.maxStaff}
            onChange={(e) => setForm((f) => ({ ...f, maxStaff: e.target.value }))} />
        </div>
        <div className="field">
          <label>Oylik SMS</label>
          <input className="input" type="number" min="0" value={form.monthlySms}
            onChange={(e) => setForm((f) => ({ ...f, monthlySms: e.target.value }))} />
        </div>
      </div>

      <label className="plan-checkbox">
        <input
          type="checkbox"
          checked={form.advancedStats}
          onChange={(e) => setForm((f) => ({ ...f, advancedStats: e.target.checked }))}
        />
        Kengaytirilgan statistika
      </label>

      <button className="btn btn-primary btn-block" disabled={busy} style={{ marginTop: 10 }}>
        {busy ? <span className="spinner" /> : 'Saqlash'}
      </button>
    </form>
  );
}
