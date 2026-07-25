import { useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from './Toast.jsx';
import './BroadcastCard.css';

const MAX_LEN = 1000;

/**
 * Sends a platform-wide announcement to every active shop owner
 * (Telegram if linked, SMS otherwise — same channel rule as debtor reminders).
 */
export default function BroadcastCard() {
  const toast = useToast();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const send = async (e) => {
    e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) return toast('Xabar matnini kiriting', 'error');
    setBusy(true);
    try {
      const res = await api.adminBroadcast(trimmed);
      toast(
        `Yuborildi: ${res.telegramSent} Telegram, ${res.smsSent} SMS orqali` +
          (res.failed ? ` (${res.failed} ta yetkazilmadi)` : '')
      );
      setMessage('');
      setOpen(false);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button className="btn broadcast-open" onClick={() => setOpen(true)}>
        📢 Barcha do'kon egalariga xabar yuborish
      </button>
    );
  }

  return (
    <form className="card broadcast-card" onSubmit={send}>
      <div className="row between" style={{ marginBottom: 10 }}>
        <label style={{ fontWeight: 600, fontSize: 13.5 }}>Xabar yuborish</label>
        <button type="button" className="modal-x" onClick={() => setOpen(false)}>✕</button>
      </div>
      <textarea
        className="input broadcast-textarea"
        value={message}
        onChange={(e) => setMessage(e.target.value.slice(0, MAX_LEN))}
        placeholder="Masalan: Ertaga 02:00–04:00 orasida texnik ishlar o'tkaziladi, tizim vaqtincha ishlamasligi mumkin."
        autoFocus
      />
      <div className="row between broadcast-foot">
        <span className="muted small">{message.length}/{MAX_LEN}</span>
        <button className="btn btn-primary" disabled={busy || !message.trim()}>
          {busy ? <span className="spinner" /> : 'Yuborish'}
        </button>
      </div>
      <p className="muted small broadcast-hint">
        Barcha faol do'kon egalariga: Telegram bog'langan bo'lsa Telegram orqali, aks holda SMS orqali.
      </p>
    </form>
  );
}
