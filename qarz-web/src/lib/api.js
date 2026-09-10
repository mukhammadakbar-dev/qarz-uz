const getApiBase = () => {
  if (import.meta.env.VITE_API_BASE_URL !== undefined) return import.meta.env.VITE_API_BASE_URL;
  return '';
};

const API_BASE = getApiBase();

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
  let data = {};
  if (text) {
    try { data = JSON.parse(text); } catch { data = {}; }
  }
  if (!res.ok) {
    if (res.status === 401) {
      tokenStore.clear();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('auth:unauthorized'));
      }
    }
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

  // --- Super Admin Endpoints ---
  adminShops: ({ search, plan, status } = {}) => {
    const q = new URLSearchParams();
    if (search) q.set('search', search);
    if (plan) q.set('plan', plan);
    if (status) q.set('status', status);
    const qs = q.toString();
    return raw(`/api/admin/shops${qs ? '?' + qs : ''}`);
  },
  adminStats: () => raw('/api/admin/stats'),
  adminPlans: () => raw('/api/admin/plans'),
  adminUpdatePlan: (code, payload) =>
    raw(`/api/admin/plans/${code}`, { method: 'PATCH', body: payload }),
  adminSetShopActive: (shopId, active) =>
    raw(`/api/admin/shops/${shopId}/active`, { method: 'PATCH', body: { active } }),
  adminExtendSubscription: (shopId, payload) =>
    raw(`/api/admin/shops/${shopId}/subscription`, { method: 'PATCH', body: payload }),
  adminSubscriptionPayments: (shopId) =>
    raw(`/api/admin/shops/${shopId}/subscription-payments`),
  adminAddSmsQuota: (shopId, amount) =>
    raw(`/api/admin/shops/${shopId}/sms`, { method: 'POST', body: { amount } }),
  adminAuditLog: () => raw('/api/admin/audit-log'),
  adminBroadcast: (message, target = 'all') =>
    raw('/api/admin/broadcast', { method: 'POST', body: { message, target } }),
};
