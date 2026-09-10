import { config } from './config.js';
import { sessions } from './sessions.js';

/**
 * Thin fetch wrapper around the Qarz backend API.
 *
 * Auth-aware calls pass `tgId` instead of a raw token: the wrapper pulls the
 * access token from the session, and on a 401 it transparently refreshes and
 * replays the original request once.
 */
export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Raised when the session is unrecoverable and the user must /start again. */
export class SessionExpiredError extends ApiError {
  constructor() {
    super('Sessiya muddati tugagan', 401, 'SESSION_EXPIRED');
  }
}

const rawFetch = async (path, { method = 'GET', body, token, botSecret = false } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  // Proves this call came from our own bot, letting the backend skip the
  // registration OTP (a shared Telegram contact already proves phone ownership).
  if (botSecret && config.botSharedSecret) headers['x-bot-secret'] = config.botSharedSecret;

  // fetch() throws a TypeError outright if a GET/HEAD carries a body, so build
  // the init object without the key rather than passing `undefined`.
  const init = { method, headers };
  if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(`${config.apiBaseUrl}${path}`, init);
  } catch (err) {
    throw new ApiError(`Server bilan aloqa yo'q: ${err.message}`, 0, 'NETWORK');
  }

  const text = await res.text();
  let data = {};
  if (text) {
    try { data = JSON.parse(text); } catch { data = {}; }
  }
  if (!res.ok) {
    throw new ApiError(data?.error?.message || `HTTP ${res.status}`, res.status, data?.error?.code);
  }
  return data;
};

/** Unauthenticated call (login, register, OTP endpoints). */
const publicRequest = (path, opts = {}) => rawFetch(path, opts);

/**
 * Authenticated call bound to a Telegram user's session.
 * Refreshes the access token once on 401, then retries.
 */
const authRequest = async (tgId, path, opts = {}) => {
  const sess = sessions.get(tgId);
  if (!sess?.accessToken) throw new SessionExpiredError();

  try {
    return await rawFetch(path, { ...opts, token: sess.accessToken });
  } catch (err) {
    if (err.status !== 401) throw err;

    // try to refresh
    if (!sess.refreshToken) {
      sessions.clear(tgId);
      throw new SessionExpiredError();
    }
    let refreshed;
    try {
      refreshed = await rawFetch('/api/auth/refresh', {
        method: 'POST',
        body: { refreshToken: sess.refreshToken },
      });
    } catch {
      sessions.clear(tgId);
      throw new SessionExpiredError();
    }

    sessions.set(tgId, {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
    });

    // replay the original request exactly once
    try {
      return await rawFetch(path, { ...opts, token: refreshed.accessToken });
    } catch (retryErr) {
      if (retryErr.status === 401) {
        sessions.clear(tgId);
        throw new SessionExpiredError();
      }
      throw retryErr;
    }
  }
};

export const api = {
  ApiError,
  SessionExpiredError,

  // --- Auth (two-step Telegram linking) ---
  requestTelegramLink: (phone) =>
    publicRequest('/api/auth/telegram/request-link', {
      method: 'POST',
      body: { phone },
    }),

  confirmTelegramLink: (phone, telegramId, otp) =>
    publicRequest('/api/auth/telegram/confirm-link', {
      method: 'POST',
      body: { phone, telegramId, otp },
    }),


  directLinkByContact: (phone, telegramId) =>
    publicRequest('/api/auth/telegram/direct-link', {
      method: 'POST',
      body: { phone, telegramId },
      botSecret: true,
    }),

  registerShop: (phone, password, fullName, shopName, telegramId) =>
    publicRequest('/api/auth/register/shop', {
      method: 'POST',
      body: { phone, password, fullName, shopName, telegramId },
      botSecret: true,
    }),

  registerPersonal: (phone, password, fullName, telegramId) =>
    publicRequest('/api/auth/register/personal', {
      method: 'POST',
      body: { phone, password, fullName, telegramId },
      botSecret: true,
    }),

  // --- Debtors ---
  createDebtor: (tgId, payload) =>
    authRequest(tgId, '/api/debtors', { method: 'POST', body: payload }),

  listDebtors: (tgId, { search, filter } = {}) => {
    const q = new URLSearchParams();
    if (search) q.set('search', search);
    if (filter) q.set('filter', filter);
    const qs = q.toString();
    return authRequest(tgId, `/api/debtors${qs ? '?' + qs : ''}`);
  },

  debtorHistory: (tgId, debtorId) =>
    authRequest(tgId, `/api/debtors/${debtorId}/debts`),

  // --- Debts ---
  addDebt: (tgId, payload) =>
    authRequest(tgId, '/api/debts', { method: 'POST', body: payload }),

  getDebtReceiptBuffer: async (tgId, debtId) => {
    const sess = sessions.get(tgId);
    if (!sess?.accessToken) throw new SessionExpiredError();
    const res = await fetch(`${config.apiBaseUrl}/api/debts/${debtId}/receipt`, {
      headers: { Authorization: `Bearer ${sess.accessToken}` }
    });
    if (!res.ok) throw new ApiError('Kvitansiyani yuklashda xatolik', res.status);
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  },

  payDebt: (tgId, debtId, payload) =>
    authRequest(tgId, `/api/debts/${debtId}/payments`, { method: 'POST', body: payload }),

  paymentLink: (tgId, debtId) =>
    authRequest(tgId, `/api/debts/${debtId}/payment-link`, { method: 'POST' }),


  // --- Public config / tariffs (no auth) ---
  publicConfig: () => publicRequest('/api/config/public'),
  plans: () => publicRequest('/api/config/plans'),

  // --- Shop ---
  dashboard: (tgId) => authRequest(tgId, '/api/shop/dashboard'),

  dailySales: (tgId, cashCard, saleDate) =>
    authRequest(tgId, '/api/shop/daily-sales', {
      method: 'POST',
      body: { cashCard, saleDate },
    }),
};
