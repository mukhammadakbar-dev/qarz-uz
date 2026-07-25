import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { fmtDate } from '../lib/format.js';
import { useToast } from '../components/Toast.jsx';
import PageHeader from '../components/PageHeader.jsx';

const ACTION_LABEL = {
  update_plan: 'Tarif yangilandi',
  block_shop: "Do'kon bloklandi",
  activate_shop: "Do'kon faollashtirildi",
};

export default function SuperAdminAuditLog() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await api.adminAuditLog();
        if (alive) setRows(Array.isArray(data) ? data : []);
      } catch (err) {
        if (alive) toast(err.message, 'error');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [toast]);

  return (
    <>
      <PageHeader title="Faoliyat jurnali" subtitle="Super admin tomonidan qilingan amallar" />
      <div className="card" style={{ overflow: 'hidden' }}>
        {loading ? (
          <div className="list-loading"><span className="spinner" /></div>
        ) : rows.length === 0 ? (
          <div className="empty"><p className="empty-title">Hali yozuv yo'q</p></div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Vaqt</th>
                <th>Kim</th>
                <th>Amal</th>
                <th>Tafsilot</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="muted small">{fmtDate(r.created_at)}</td>
                  <td className="muted num">{r.actor_phone || '—'}</td>
                  <td>{ACTION_LABEL[r.action] || r.action}</td>
                  <td className="muted small audit-meta">
                    {r.meta ? JSON.stringify(r.meta) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
