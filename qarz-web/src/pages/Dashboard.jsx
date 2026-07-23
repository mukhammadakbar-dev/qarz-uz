import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { som, grp } from '../lib/format.js';
import { useToast } from '../components/Toast.jsx';
import PageHeader from '../components/PageHeader.jsx';
import SalesChart from '../components/SalesChart.jsx';
import './Dashboard.css';

export default function Dashboard() {
  const toast = useToast();
  const [stats, setStats] = useState(null);
  const [series, setSeries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const from = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
        const [d, s] = await Promise.all([api.dashboard(), api.salesRange(from)]);
        if (!alive) return;
        setStats(d);
        setSeries(Array.isArray(s) ? s : []);
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [toast]);

  const smsLeft = stats?.sms ? stats.sms.remaining + (stats.sms.extra_package || 0) : 0;

  return (
    <>
      <PageHeader title="Boshqaruv paneli" subtitle="Do'koningizning umumiy holati" />

      {loading ? (
        <Skeleton />
      ) : (
        <>
          <div className="stat-grid">
            <StatCard
              label="Umumiy qarz"
              value={som(stats.totalOutstanding)}
              hint="Undirilmagan"
              tone="ink"
            />
            <StatCard
              label="Muddati o'tgan"
              value={`${stats.overdueCount} ta`}
              hint={som(stats.overdueTotal)}
              tone="danger"
            />
            <StatCard
              label="Oylik aylanma"
              value={som(stats.monthlyTurnover)}
              hint="Shu oy"
              tone="ink"
            />
            <StatCard
              label="SMS qoldiq"
              value={`${grp(smsLeft)} ta`}
              hint={stats.sms ? `Limit: ${grp(stats.sms.monthly_limit)}` : '—'}
              tone={smsLeft <= 5 ? 'warn' : 'ink'}
            />
          </div>

          <div className="card chart-card">
            <div className="row between chart-head">
              <div>
                <h2 className="chart-title">Savdo dinamikasi</h2>
                <p className="muted small">So'nggi 30 kun — naqd/karta + qarzga berilgan</p>
              </div>
              <div className="legend">
                <span className="lg lg-cash">Naqd/karta</span>
                <span className="lg lg-debt">Qarz</span>
              </div>
            </div>
            <SalesChart data={series} />
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
