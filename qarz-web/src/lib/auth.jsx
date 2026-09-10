import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api, tokenStore } from './api.js';

const AuthCtx = createContext(null);

const decodeJwtPayload = (token) => {
  const part = token?.split('.')[1];
  if (!part) return null;
  let b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  b64 += '='.repeat((4 - (b64.length % 4)) % 4);
  try {
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
};

const decodeRole = () => {
  const t = tokenStore.get();
  if (!t) return null;
  try {
    const payload = decodeJwtPayload(t);
    if (!payload || payload.role !== 'super_admin') {
      tokenStore.clear();
      return null;
    }
    return { role: payload.role, id: payload.sub, phone: payload.phone };
  } catch {
    return null;
  }
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(decodeRole);

  useEffect(() => {
    const handleUnauthorized = () => {
      tokenStore.clear();
      setUser(null);
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, []);

  const login = useCallback(async (phone, password) => {
    const res = await api.login(phone, password);
    if (res.user.role !== 'super_admin') {
      tokenStore.clear();
      throw new Error('Sayt faqat SuperAdmin uchun ochiq. Foydalanuvchilar Telegram Botdan foydalanadi.');
    }
    tokenStore.set(res.accessToken, res.refreshToken);
    setUser({ role: res.user.role, id: res.user.id, phone: res.user.phone });
    return res;
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  return (
    <AuthCtx.Provider value={{ user, login, logout }}>
      {children}
    </AuthCtx.Provider>
  );
};

export const useAuth = () => useContext(AuthCtx);
