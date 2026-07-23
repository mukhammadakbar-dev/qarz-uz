const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';

const TOKEN_KEY = 'qarz_access';
const REFRESH_KEY = 'qarz_refresh';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  getRefresh: () => localStorage.getItem(REFRESH_KEY),
  set: (access, refresh) => {
    if (access) localStorage.setItem(TOKEN_KEY, access);
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const raw = async (path, { method = 'GET', body, token, retry = true } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  const t = token ?? tokenStore.get();
  if (t) headers.Authorization = `Bearer ${t}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // auto-refresh once on 401
  if (res.status === 401 && retry && tokenStore.getRefresh()) {
    const ok = await tryRefresh();
    if (ok) return raw(path, { method, body, retry: false });
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new ApiError(data?.error?.message || `HTTP ${res.status}`, res.status, data?.error?.code);
  }
  return data;
};

const tryRefresh = async () => {
  try {
    const res = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokenStore.getRefresh() }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    tokenStore.set(data.accessToken, data.refreshToken);
    return true;
  } catch {
    return false;
  }
};

export const api = {
  login: (phone, password) =>
    raw('/api/auth/login', { method: 'POST', body: { phone, password } }),

  registerShop: (payload) =>
    raw('/api/auth/register/shop', { method: 'POST', body: payload }),

  dashboard: () => raw('/api/shop/dashboard'),

  salesRange: (from, to) => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    const qs = q.toString();
    return raw(`/api/shop/daily-sales${qs ? '?' + qs : ''}`);
  },

  saveDailySales: (cashCard, saleDate) =>
    raw('/api/shop/daily-sales', { method: 'POST', body: { cashCard, saleDate } }),

  listDebtors: ({ search, filter } = {}) => {
    const q = new URLSearchParams();
    if (search) q.set('search', search);
    if (filter) q.set('filter', filter);
    const qs = q.toString();
    return raw(`/api/debtors${qs ? '?' + qs : ''}`);
  },

  createDebtor: (payload) =>
    raw('/api/debtors', { method: 'POST', body: payload }),

  debtorHistory: (debtorId) => raw(`/api/debtors/${debtorId}/debts`),

  addDebt: (payload) => raw('/api/debts', { method: 'POST', body: payload }),

  payDebt: (debtId, payload) =>
    raw(`/api/debts/${debtId}/payments`, { method: 'POST', body: payload }),

  paymentLink: (debtId) =>
    raw(`/api/debts/${debtId}/payment-link`, { method: 'POST' }),
};
