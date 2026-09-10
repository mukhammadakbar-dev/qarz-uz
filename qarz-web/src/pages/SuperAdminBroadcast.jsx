import { useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';
import PageHeader from '../components/PageHeader.jsx';
import './SuperAdminBroadcast.css';

const TARGET_OPTIONS = [
  { id: 'all', icon: '📢', label: 'Barcha Do\'konlar', sub: 'Platformadagi barcha faol do\'kon egalari' },
  { id: 'telegram_all', icon: '🤖', label: 'Botga /start Bosganlar', sub: 'Bot bilan muloqot qilgan barcha Telegram foydalanuvchilariga' },
  { id: 'active', icon: '✅', label: 'Faol Obunachilar', sub: 'Aktiv pullik tarifdagi do\'konlar' },
  { id: 'trial', icon: '⏳', label: 'Sinov Muddatidagilar', sub: '14 kunlik bepul sinovdagi do\'konlar' },
  { id: 'expired', icon: '⚠️', label: 'Obunasi Tugaganlar', sub: 'Obuna muddati tugab bo\'lgan do\'konlar' },
  { id: 'blocked', icon: '🚫', label: 'Bloklangan Do\'konlar', sub: 'Vaqtincha to\'xtatilgan do\'kon egalari' },
  { id: 'plan_start', icon: '🟢', label: 'Start Tarifi', sub: 'Start tarif rejasidagi do\'konlar' },
  { id: 'plan_pro', icon: '🔵', label: 'Pro Tarifi', sub: 'Pro tarif rejasidagi do\'konlar' },
  { id: 'plan_business', icon: '🟣', label: 'Business Tarifi', sub: 'Business tarif rejasidagi do\'konlar' },
];

export default function SuperAdminBroadcast() {
  const toast = useToast();
  const [target, setTarget] = useState('all');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const selectedOption = TARGET_OPTIONS.find((t) => t.id === target) || TARGET_OPTIONS[0];

  const submit = async (e) => {
    e.preventDefault();
    if (!message.trim()) {
      toast('Xabar matnini kiriting', 'error');
      return;
    }

    setBusy(true);
    setResult(null);
    try {
      const res = await api.adminBroadcast(message.trim(), target);
      setResult(res);
      toast('✅ Tizim e\'loni muvaffaqiyatli yuborildi');
      setMessage('');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Tizim E'lonlari (Broadcast)"
        subtitle="Do'kon egalariga maqsadli auditoriyalar bo'yicha e'lon va xabarnomalar yuborish"
      />

      <div className="broadcast-root">
        <div className="card broadcast-card-main">
          <h3>Yangi Xabar Yuborish</h3>
          <p className="subtext">
            Ushbu xabar tanlangan auditoriyadagi do'kon egalarining veb-saytidagi e'lonlar panelida saqlanadi va Telegram bot orqali yetkaziladi.
          </p>

          <form onSubmit={submit} className="broadcast-form">
            <div className="field">
              <label>Maqsadli Auditoriya (Kimga yuboriladi?)</label>
              <div className="target-grid">
                {TARGET_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`target-chip ${target === opt.id ? 'active' : ''}`}
                    onClick={() => setTarget(opt.id)}
                  >
                    <span className="target-chip-icon">{opt.icon}</span>
                    <div className="target-chip-info">
                      <div className="target-chip-title">{opt.label}</div>
                      <div className="target-chip-sub">{opt.sub}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>Xabar matni</label>
              <textarea
                className="input textarea"
                rows="6"
                placeholder="Masalan: Bugun soat 23:00 da profilaktika ishlari o'tkaziladi..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={1000}
                required
              />
              <div className="field-hint" style={{ marginTop: '6px', textAlign: 'right', fontSize: '12px', color: '#8e8ea0' }}>
                {message.length} / 1000 belgi
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={busy || !message.trim()}>
                {busy ? 'Yuborilmoqda...' : `${selectedOption.icon} ${selectedOption.label} auditoriyasiga yuborish`}
              </button>
            </div>
          </form>

          {result && (
            <div className="result-card card" style={{ marginTop: '24px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '16px' }}>
              <h4 style={{ color: '#10b981', margin: '0 0 8px 0' }}>✅ E'lon Yetkazildi</h4>
              <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '14px', lineHeight: '1.6' }}>
                <li><b>Maqsadli auditoriya:</b> {TARGET_OPTIONS.find((t) => t.id === result.target)?.label || result.target}</li>
                <li><b>Qamrab olingan do'konlar:</b> {result.totalOwners} ta</li>
                <li><b>Telegram orqali yetkazildi:</b> {result.telegramSent} ta</li>
                {result.failed > 0 && <li style={{ color: '#ef4444' }}><b>Telegram xatolik:</b> {result.failed} ta</li>}
              </ul>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
