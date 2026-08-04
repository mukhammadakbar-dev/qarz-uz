import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

const ToastCtx = createContext(null);

export const ToastProvider = ({ children }) => {
  const [toast, setToast] = useState(null);
  // One timer at a time: without this, a second toast inherits the first
  // toast's pending timeout and disappears early, and the timer keeps running
  // (setting state) after the provider unmounts.
  const timerRef = useRef(null);

  const show = useCallback((message, type = 'info') => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ message, type });
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setToast(null);
    }, 2800);
  }, []);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && (
        <div className={`toast ${toast.type === 'error' ? 'toast-error' : ''}`}>
          {toast.message}
        </div>
      )}
    </ToastCtx.Provider>
  );
};

export const useToast = () => useContext(ToastCtx);
