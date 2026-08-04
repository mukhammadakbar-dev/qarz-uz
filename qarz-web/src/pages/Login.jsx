import { useState, useEffect, useRef, useCallback } from 'react';
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
  const [smsConfigured, setSmsConfigured] = useState(true);
  // 'sms' -> user types a code; 'telegram' -> the bot confirms and we poll
  const [channel, setChannel] = useState('sms');
  const [tgVerified, setTgVerified] = useState(false);
  const [form, setForm] = useState({
    phone: '', password: '', fullName: '', shopName: '', otp: '', verifyToken: '',
  });

  // Polling handle for the Telegram handshake. Kept in a ref (not state) so
  // stopPolling is stable, and always cleared on unmount — the previous version
  // left a 2s interval running for the lifetime of the page whenever the user
  // never completed verification.
  const pollRef = useRef(null);
  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);
  useEffect(() => stopPolling, [stopPolling]);

  useEffect(() => {
    let alive = true;
    api.getSmsStatus()
      .then((res) => { if (alive) setSmsConfigured(res.configured); })
      .catch(() => { if (alive) setSmsConfigured(false); });
    return () => { alive = false; };
  }, []);

  const isReg = mode === 'register' || mode === 'personal';
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const goHome = (role) =>
    navigate(role === 'super_admin' ? '/super-admin' : '/', { replace: true });

  const doLogin = async () => {
    const res = await login(form.phone, form.password);
    goHome(res.user.role);
  };

  /**
   * Poll until the bot reports the phone as verified. Bounded: gives up after
   * MAX_POLLS so a page left open never keeps hitting the API forever.
   */
  const startVerifyPolling = (verifyToken) => {
    stopPolling();
    const MAX_POLLS = 150; // 150 x 2s = 5 minutes
    let polls = 0;
    pollRef.current = setInterval(async () => {
      if (++polls > MAX_POLLS) return stopPolling();
      try {
        const status = await api.getVerifyStatus(verifyToken);
        if (status.verified) {
          stopPolling();
          setTgVerified(true);
          toast('Telegram orqali tasdiqlandi! ✅');
        } else if (status.expired) {
          stopPolling();
          toast('Tasdiqlash muddati tugadi, qaytadan boshlang', 'error');
        }
      } catch {
        stopPolling();
      }
    }, 2000);
  };

  // Step 1: ask the backend for confirmation code
  const requestOtpChannel = async (requestedChannel) => {
    if (!form.phone || form.phone.trim().length < 7) {
      toast("Telefon raqamingizni kiriting", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await api.requestRegisterOtp(form.phone, requestedChannel);
      if (requestedChannel === 'sms') {
        setChannel('sms');
        setTgVerified(false);
        setStep(2);
        toast('Tasdiqlash kodi SMS orqali yuborildi');
      } else if (res.deepLink && res.verifyToken) {
        setChannel('telegram');
        setTgVerified(false);
        setForm((f) => ({ ...f, verifyToken: res.verifyToken, otp: '' }));
        setStep(2);
        toast('Telegram botda raqamingizni ulashing');
        window.open(res.deepLink, '_blank', 'noopener,noreferrer');
        startVerifyPolling(res.verifyToken);
      }
    } catch (err) {
      if (err.code === 'SMS_NOT_CONFIGURED') {
        toast('SMS orqali yuborish hozircha ishlamayapti, iltimos Telegram orqali urinib ko\'ring.', 'error');
      } else {
        toast(err.message, 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  // Step 2: create the account, proving the phone with whichever channel was used
  const completeRegister = async () => {
    const proof =
      channel === 'telegram'
        ? { verifyToken: form.verifyToken }
        : { otp: form.otp };
    const payload = {
      phone: form.phone,
      password: form.password,
      fullName: form.fullName || undefined,
      ...proof,
    };
    const res =
      mode === 'register'
        ? await registerShop({ ...payload, shopName: form.shopName })
        : await registerPersonal(payload);
    goHome(res.user.role);
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'login') await doLogin();
      else if (step === 2) await completeRegister();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next) => {
    stopPolling();
    setMode(next);
    setStep(1);
    setTgVerified(false);
    setForm((f) => ({ ...f, otp: '', verifyToken: '' }));
  };

  const backToDetails = () => {
    stopPolling();
    setStep(1);
    setTgVerified(false);
    setForm((f) => ({ ...f, otp: '', verifyToken: '' }));
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
        : channel === 'telegram'
          ? `${form.phone} raqamini Telegram botda ulashib tasdiqlang.`
          : `${form.phone} raqamiga yuborilgan 6 xonali kodni kiriting.`;

  return (
    <div className="auth-wrap">
      <div className="auth-card card">
        <div className="auth-brand">
          <span className="brand-mark">T</span>
          <span className="brand-name">TemirDaftar<span className="brand-dim">.uz</span></span>
        </div>

        <h1 className="auth-title">{title}</h1>
        <p className="auth-sub muted">{subtitle}</p>

        <form onSubmit={submit}>
          {isReg && step === 2 ? (
            <>
              {channel === 'telegram' ? (
                <div className="field tg-verify">
                  {tgVerified ? (
                    <p className="verify-ok">✅ Raqamingiz tasdiqlandi.</p>
                  ) : (
                    <p className="muted">
                      <span className="spinner spinner-inline" /> Telegram botda
                      raqamingizni ulashing — bu sahifa avtomatik davom etadi.
                    </p>
                  )}
                </div>
              ) : (
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
              )}
              <button
                className="btn btn-primary btn-block"
                disabled={busy || (channel === 'telegram' ? !tgVerified : form.otp.length !== 6)}
              >
                {busy ? <span className="spinner" /> : 'Tasdiqlash va ochish'}
              </button>
              <button
                type="button"
                className="link-btn auth-back"
                onClick={backToDetails}
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

              {mode === 'login' ? (
                <button className="btn btn-primary btn-block" disabled={busy} style={{ marginTop: 12 }}>
                  {busy ? <span className="spinner" /> : 'Kirish'}
                </button>
              ) : (
                <div className="channel-buttons" style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <button
                    type="button"
                    className={`btn ${smsConfigured ? 'btn-secondary' : 'btn-outline'}`}
                    onClick={() => {
                      if (!smsConfigured) toast('SMS xizmati hozircha mavjud emas', 'error');
                      else requestOtpChannel('sms');
                    }}
                    disabled={busy}
                    style={!smsConfigured ? { opacity: 0.6, cursor: 'not-allowed' } : {}}
                  >
                    📩 SMS orqali kod olish
                  </button>
                  {!smsConfigured && (
                    <span className="muted small" style={{ fontSize: 12, textAlign: 'center' }}>
                      SMS xizmati hozircha mavjud emas
                    </span>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => requestOtpChannel('telegram')}
                    disabled={busy}
                  >
                    ✈️ Telegram orqali kod olish
                  </button>
                </div>
              )}
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
