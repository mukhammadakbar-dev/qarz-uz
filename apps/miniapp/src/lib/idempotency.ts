import { useCallback, useRef } from 'react';

/**
 * Bitta foydalanuvchi niyati = bitta kalit. Tarmoq xatosidan keyin "Saqlash"ni qayta bosish SHU kalit bilan ketadi
 * (server ikkinchi yozuv yaratmaydi). Niyat o'zgarsa (masalan, summa tahrirlandi) yoki muvaffaqiyatli bo'lsa — yangi kalit.
 */
export function useIdempotencyKey(): { current: () => string; rotate: () => void } {
  const ref = useRef<string | null>(null);
  const current = useCallback(() => (ref.current ??= crypto.randomUUID()), []);
  const rotate = useCallback(() => {
    ref.current = null;
  }, []);
  return { current, rotate };
}
