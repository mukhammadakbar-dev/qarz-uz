import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { som, grp } from '../lib/format.js';
import { useToast } from '../components/Toast.jsx';
import PageHeader from '../components/PageHeader.jsx';
import SalesChart from '../components/SalesChart.jsx';
import TrialBanner from '../components/TrialBanner.jsx';
import DateRangePicker, { PRESETS, describeRange } from '../components/DateRangePicker.jsx';
import './Dashboard.css';

const RANGE_KEY = 'qarz_dash_range';

/** Restore the last-used range, falling back to 30 days. */
const initialRange = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(RANGE_KEY) || 'null');
    if (saved?.key && (saved.key === 'custom' ? saved.from && saved.to : PRESETS[saved.key])) {
      if (saved.key !== 'custom') {
        const p = PRESETS[saved.key];
        return { key: saved.key, from: p.from(), to: p.to() };
      }
      return saved;
    }
  } catch { /* ignore malformed storage */ }
  return { key: '30', from: PRESETS['30'].from(), to: PRESETS['30'].to() };
};

export default function Dashboard() {
  const toast = useToast();
  const [stats, setStats] = useState(null);
  const [series, setSeries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(false);
  const [range, setRange] = useState(initialRange);

  // Stats load once; the chart reloads whenever the range changes.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await api.dashboard();
        if (alive) setStats(d);
      } catch (err) {
        if (alive) toast(err.message, 'error');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [toast]);

  const loadSeries = useCallback(async (r) => {
    setChartLoading(true);
    try {
      const s = await api.salesRange(r.from, r.to);
      setSeries(Array.isArray(s) ? s : []);
    } catch (err) {
      setSeries([]);
      toast(err.message, 'error');
    } finally {
      setChartLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadSeries(range); }, [range, loadSeries]);

  const changeRange = (next) => {
    setRange(next);
    try { localStorage.setItem(RANGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const smsLeft = stats?.sms ? stats.sms.remaining + (stats.sms.extra_package || 0) : 0;

  return (
    <>
      <PageHeader title="Boshqaruv paneli" subtitle="Do'koningizning umumiy holati" />

      {stats?.subscription && (
        <TrialBanner
          subscription={stats.subscription}
          onChoosePlan={() => toast('Tariflar sahifasi tez orada qo\'shiladi')}
        />
      )}

      {loading ? (
        <Skeleton />
      ) : (
        <>
          <div className="stat-grid">
            <StatCard label="Umumiy qarz" value={som(stats.totalOutstanding)} hint="Undirilmagan" tone="ink" />
            <StatCard label="Muddati o'tgan" value={`${stats.overdueCount} ta`} hint={som(stats.overdueTotal)} tone="danger" />
            <StatCard label="Oylik aylanma" value={som(stats.monthlyTurnover)} hint="Shu oy" tone="ink" />
            <StatCard label="SMS qoldiq" value={`${grp(smsLeft)} ta`}
              hint={stats.sms ? `Limit: ${grp(stats.sms.monthly_limit)}` : '—'}
              tone={smsLeft <= 5 ? 'warn' : 'ink'} />
          </div>

          <div className="card chart-card">
            <div className="row between chart-head">
              <div>
                <h2 className="chart-title">Savdo dinamikasi</h2>
                <p className="muted small">
                  {describeRange(range.key, range.from, range.to)} — naqd/karta + qarzga berilgan
                </p>
              </div>
              <div className="legend">
                <span className="lg lg-cash">Naqd/karta</span>
                <span className="lg lg-debt">Qarz</span>
              </div>
            </div>

            <DateRangePicker value={range} onChange={changeRange} />

            <div className={chartLoading ? 'chart-dim' : ''}>
              <SalesChart data={series} />
            </div>
          </div>
        </>
      )}
    </>
  );
}

function StatCard({ label, value, hint, tone }) {
  return (
    <div className="card stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value num tone-${tone}`}>{value}</div>
      <div className="stat-hint muted small">{hint}</div>
    </div>
  );
}

function Skeleton() {
  return (
    <>
      <div className="stat-grid">
        {[0, 1, 2, 3].map((i) => <div key={i} className="card stat sk" />)}
      </div>
      <div className="card chart-card sk" style={{ height: 260 }} />
    </>
  );
}
