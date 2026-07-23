import { config } from '../config/index.js';

const BASE = 'https://notify.eskiz.uz/api';
let cachedToken = null;
let tokenExpiry = 0;

/**
 * Authenticate with Eskiz and cache the bearer token (valid ~30 days).
 */
const getToken = async () => {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  if (!config.eskiz.email || !config.eskiz.password) {
    throw new Error('Eskiz sozlanmagan (ESKIZ_EMAIL / ESKIZ_PASSWORD)');
  }
  const body = new URLSearchParams({
    email: config.eskiz.email,
    password: config.eskiz.password,
  });
  const res = await fetch(`${BASE}/auth/login`, { method: 'POST', body });
  if (!res.ok) throw new Error(`Eskiz auth failed: ${res.status}`);
  const data = await res.json();
  cachedToken = data?.data?.token;
  tokenExpiry = Date.now() + 25 * 24 * 60 * 60 * 1000; // refresh ~25 days
  return cachedToken;
};

/**
 * Send an SMS. Returns { ok, id?, error? }.
 * In dev (no creds) it logs instead of failing.
 */
export const sendSms = async (phone, message) => {
  if (!config.eskiz.email || !config.eskiz.password) {
    console.log(`[sms:dev] -> ${phone}: ${message}`);
    return { ok: true, id: 'dev-' + Date.now(), dev: true };
  }
  try {
    const token = await getToken();
    const body = new URLSearchParams({
      mobile_phone: phone.replace('+', ''),
      message,
      from: config.eskiz.from,
    });
    const res = await fetch(`${BASE}/message/sms/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.message || `HTTP ${res.status}` };
    return { ok: true, id: data?.id };
  } catch (err) {
    return { ok: false, error: err.message };
  }
};
