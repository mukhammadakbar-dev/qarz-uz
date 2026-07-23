import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../components/Toast.jsx';
import './Login.css';

export default function Login() {
  const { login, registerShop } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ phone: '', password: '', fullName: '', shopName: '' });

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'login') {
        await login(form.phone, form.password);
      } else {
        await registerShop({
          phone: form.phone,
          password: form.password,
          fullName: form.fullName || undefined,
          shopName: form.shopName,
        });
      }
      navigate('/');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card card">
        <div className="auth-brand">
          <span className="brand-mark">Q</span>
          <span className="brand-name">Qarz<span className="brand-dim">.uz</span></span>
        </div>

        <h1 className="auth-title">
          {mode === 'login' ? 'Hisobingizga kiring' : 'Do\'kon ochish'}
        </h1>
        <p className="auth-sub muted">
          {mode === 'login'
            ? 'Qarzlaringizni boshqarish uchun kiring.'
            : '14 kun bepul — karta talab qilinmaydi.'}
        </p>

        <form onSubmit={submit}>
          {mode === 'register' && (
            <div className="field">
              <label>Do'kon nomi</label>
              <input className="input" value={form.shopName} onChange={set('shopName')}
                placeholder="Masalan: Diyor Market" required />
            </div>
          )}

          <div className="field">
            <label>Telefon raqam</label>
            <input className="input" value={form.phone} onChange={set('phone')}
              placeholder="90 123 45 67" inputMode="tel" required />
          </div>

          {mode === 'register' && (
            <div className="field">
              <label>Ismingiz <span className="muted">(ixtiyoriy)</span></label>
              <input className="input" value={form.fullName} onChange={set('fullName')}
                placeholder="Ism familiya" />
            </div>
          )}

          <div className="field">
            <label>Parol</label>
            <input className="input" type="password" value={form.password} onChange={set('password')}
              placeholder="Kamida 6 belgi" minLength={6} required />
          </div>

          <button className="btn btn-primary btn-block" disabled={busy} style={{ marginTop: 6 }}>
            {busy ? <span className="spinner" /> : mode === 'login' ? 'Kirish' : 'Ro\'yxatdan o\'tish'}
          </button>
        </form>

        <div className="auth-switch">
          {mode === 'login' ? (
            <>Do'koningiz yo'qmi?{' '}
              <button className="link-btn" onClick={() => setMode('register')}>Do'kon oching</button>
            </>
          ) : (
            <>Akkauntingiz bormi?{' '}
              <button className="link-btn" onClick={() => setMode('login')}>Kirish</button>
            </>
          )}
        </div>
      </div>

      <p className="auth-legal muted small">
        Kirish orqali xizmat shartlariga rozilik bildirasiz.
      </p>
    </div>
  );
}
