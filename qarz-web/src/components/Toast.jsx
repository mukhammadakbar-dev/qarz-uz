import { createContext, useContext, useState, useCallback } from 'react';

const ToastCtx = createContext(null);

export const ToastProvider = ({ children }) => {
  const [toast, setToast] = useState(null);

  const show = useCallback((message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2800);
  }, []);

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
