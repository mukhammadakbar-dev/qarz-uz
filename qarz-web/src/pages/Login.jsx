import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';
import { Eye, EyeOff } from '../components/icons.jsx';
import './Login.css';

/** Password field with a reveal toggle. */
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
  const { login, registerShop, registerPersonal } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  // 'login' | 'register' (shop owner) | 'personal' (free account)
  const [mode, setMode] = useState('login');
  const [step, setStep] = useState(1); // registration: 1 = details, 2 = OTP
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ phone: '', password: '', fullName: '', shopName: '', otp: '' });

  const isReg = mode === 'register' || mode === 'personal';
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const goHome = (role) =>
    navigate(role === 'super_admin' ? '/super-admin' : '/', { replace: true });

  const doLogin = async () => {
    const res = await login(form.phone, form.password);
    goHome(res.user.role);
  };

  // Step 1: ask the backend to text a confirmation code (both registration modes)
  const requestOtp = async () => {
    await api.requestRegisterOtp(form.phone);
    setStep(2);
    toast('Tasdiqlash kodi SMS orqali yuborildi');
  };

  // Step 2: create the account with the code
  const completeRegister = async () => {
    if (mode === 'register') {
      const res = await registerShop({
        phone: form.phone,
        password: form.password,
        fullName: form.fullName || undefined,
        shopName: form.shopName,
        otp: form.otp,
      });
      goHome(res.user.role);
    } else {
      const res = await registerPersonal({
        phone: form.phone,
        password: form.password,
        fullName: form.fullName || undefined,
        otp: form.otp,
      });
      goHome(res.user.role);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'login') await doLogin();
      else if (step === 1) await requestOtp();
      else await completeRegister();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next) => {
    setMode(next);
    setStep(1);
    setForm((f) => ({ ...f, otp: '' }));
  };

  const title =
    mode === 'login'
      ? 'Hisobingizga kiring'
      : step === 1
        ? (mode === 'register' ? "Do'kon ochish" : 'Bepul hisob ochish')
        : 'Telefonni tasdiqlang';

  const subtitle =
    mode === 'login'
      ? 'Qarzlaringizni boshqarish uchun kiring.'
      : step === 1
        ? (mode === 'register'
            ? '14 kun bepul — karta talab qilinmaydi.'
            : 'Shaxsiy qarz-daftaringiz — butunlay bepul.')
        : `${form.phone} raqamiga yuborilgan 6 xonali kodni kiriting.`;

  return (
    <div className="auth-wrap">
      <div className="auth-card card">
        <div className="auth-brand">
          <span className="brand-mark">Q</span>
          <span className="brand-name">Qarz<span className="brand-dim">.uz</span></span>
        </div>

        <h1 className="auth-title">{title}</h1>
        <p className="auth-sub muted">{subtitle}</p>

        <form onSubmit={submit}>
          {isReg && step === 2 ? (
            <>
              <div className="field">
                <label>Tasdiqlash kodi</label>
                <input
                  className="input otp-input num"
                  value={form.otp}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, otp: e.target.value.replace(/\D/g, '').slice(0, 6) }))
                  }
                  placeholder="000000"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  required
                />
              </div>
              <button className="btn btn-primary btn-block" disabled={busy || form.otp.length !== 6}>
                {busy ? <span className="spinner" /> : 'Tasdiqlash va ochish'}
              </button>
              <button
                type="button"
                className="link-btn auth-back"
                onClick={() => setStep(1)}
                disabled={busy}
              >
                &larr; Ma'lumotlarni o'zgartirish
              </button>
            </>
          ) : (
            <>
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
                  placeholder="90 123 45 67" inputMode="tel" autoComplete="tel" required />
              </div>

              {isReg && (
                <div className="field">
                  <label>Ismingiz <span className="muted">(ixtiyoriy)</span></label>
                  <input className="input" value={form.fullName} onChange={set('fullName')}
                    placeholder="Ism familiya" />
                </div>
              )}

              <PasswordField
                label="Parol"
                value={form.password}
                onChange={set('password')}
                placeholder="Kamida 6 belgi"
                minLength={6}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
              />

              <button className="btn btn-primary btn-block" disabled={busy} style={{ marginTop: 6 }}>
                {busy ? <span className="spinner" />
                  : mode === 'login' ? 'Kirish' : 'Kod olish'}
              </button>
            </>
          )}
        </form>

        <div className="auth-switch">
          {mode === 'login' ? (
            <>
              <div>Do'koningiz yo'qmi?{' '}
                <button className="link-btn" onClick={() => switchMode('register')}>Do'kon oching</button>
              </div>
              <div style={{ marginTop: 6 }}>
                Shaxsiy qarz daftari kerakmi?{' '}
                <button className="link-btn" onClick={() => switchMode('personal')}>Bepul boshlash</button>
              </div>
            </>
          ) : (
            <>Akkauntingiz bormi?{' '}
              <button className="link-btn" onClick={() => switchMode('login')}>Kirish</button>
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
