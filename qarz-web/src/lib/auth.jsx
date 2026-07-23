import { createContext, useContext, useState, useCallback } from 'react';
import { api, tokenStore } from './api.js';

const AuthCtx = createContext(null);

/**
 * Decode a JWT payload. JWTs use base64url (-/_ instead of +//) and strip
 * padding, both of which plain atob() rejects — so normalize before decoding.
 */
const decodeJwtPayload = (token) => {
  const part = token.split('.')[1];
  if (!part) return null;
  let b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  b64 += '='.repeat((4 - (b64.length % 4)) % 4); // restore padding
  return JSON.parse(atob(b64));
};

const decodeRole = () => {
  const t = tokenStore.get();
  if (!t) return null;
  try {
    const payload = decodeJwtPayload(t);
    if (!payload) return null;
    return { role: payload.role, id: payload.sub, phone: payload.phone };
  } catch {
    return null;
  }
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(decodeRole);

  const login = useCallback(async (phone, password) => {
    const res = await api.login(phone, password);
    tokenStore.set(res.accessToken, res.refreshToken);
    setUser({ role: res.user.role, id: res.user.id, phone: res.user.phone });
    return res;
  }, []);

  const registerShop = useCallback(async (payload) => {
    const res = await api.registerShop(payload);
    tokenStore.set(res.accessToken, res.refreshToken);
    setUser({ role: res.user.role, id: res.user.id, phone: res.user.phone });
    return res;
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  return (
    <AuthCtx.Provider value={{ user, login, registerShop, logout }}>
      {children}
    </AuthCtx.Provider>
  );
};

export const useAuth = () => useContext(AuthCtx);
