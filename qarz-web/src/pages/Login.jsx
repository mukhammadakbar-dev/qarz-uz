import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../components/Toast.jsx';
import { Eye, EyeOff } from '../components/icons.jsx';
import './Login.css';

/** Password field with reveal toggle. */
function PasswordField({ label, value, onChange, placeholder, ...rest }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="field">
      <label>{label}</label>
      <div className="pw-wrap">
        <input
          className="input"
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          {...rest}
        />
        <button
          type="button"
          className="pw-toggle"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? 'Parolni yashirish' : "Parolni ko'rsatish"}
          title={shown ? 'Parolni yashirish' : "Parolni ko'rsatish"}
          tabIndex={-1}
        >
          {shown ? <EyeOff /> : <Eye />}
        </button>
      </div>
    </div>
  );
}

export default function Login() {
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ phone: '', password: '' });

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const normalizeInputPhone = (val) => {
    if (!val) return '';
    let digits = val.replace(/[^\d]/g, '');
    if (digits.startsWith('998')) {
      // already 998...
    } else if (digits.length === 9) {
      digits = '998' + digits;
    } else if (digits.startsWith('8') && digits.length === 10) {
      digits = '998' + digits.slice(1);
    }
    if (digits.length !== 12) return val.trim();
    return '+' + digits;
  };

  const submit = async (e) => {
    e.preventDefault();
    const phoneToUse = normalizeInputPhone(form.phone);
    if (!phoneToUse || !form.password) {
      toast('Telefon raqam va parolni kiriting', 'error');
      return;
    }

    setBusy(true);
    try {
      await login(phoneToUse, form.password);
      navigate('/super-admin', { replace: true });
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  };

  return (
    <div className="login-root">
      <div className="login-card">
        <div className="login-head">
          <div className="logo-badge">TemirDaftar.uz</div>
          <h2>SuperAdmin Paneli</h2>
          <p className="subtext">Tizimni boshqarish uchun avtorizatsiyadan o'ting</p>
        </div>

        <form onSubmit={submit} className="login-form">
          <div className="field">
            <label>Telefon raqam</label>
            <input
              className="input"
              type="tel"
              placeholder="+998901234567"
              value={form.phone}
              onChange={set('phone')}
              required
            />
          </div>

          <PasswordField
            label="Parol"
            placeholder="••••••••"
            value={form.password}
            onChange={set('password')}
            required
          />

          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Kirilmoqda...' : 'Panelga kirish'}
          </button>
        </form>

        <div className="user-notice-card" style={{ marginTop: '24px', padding: '16px', borderRadius: '12px', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255,255,255,0.1)', textAlign: 'center' }}>
          <p style={{ fontSize: '13px', color: '#8e8ea0', marginBottom: '12px', lineHeight: '1.5' }}>
            ℹ️ <b>Oddiy foydalanuvchilar uchun:</b> TemirDaftar.uz xizmatlaridan foydalanish faqat Telegram Bot va Mini App orqali amalga oshiriladi.
          </p>
          <a
            href="https://t.me/tDaftar_bot"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-outline"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', textDecoration: 'none' }}
          >
            📲 Telegram Botni Ochish (@tDaftar_bot)
          </a>
        </div>
      </div>
    </div>
  );
}
