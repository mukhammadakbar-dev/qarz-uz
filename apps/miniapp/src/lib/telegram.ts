import {
  backButton,
  hapticFeedback,
  init,
  isTMA,
  miniApp,
  openTelegramLink,
  retrieveLaunchParams,
  retrieveRawInitData,
  themeParams,
  viewport,
} from '@telegram-apps/sdk';
import { useEffect } from 'react';

/**
 * Telegram Mini App muhiti. Hamma chaqiruv himoyalangan: ilova Telegramdan tashqarida (dev, brauzer) ham ochiladi,
 * lekin tizimga kirish uchun initData shart (faqat dev rejimida VITE_DEV_INIT_DATA).
 */

const safe = (fn: () => unknown): void => {
  try {
    const r = fn();
    if (r instanceof Promise) r.catch(() => undefined);
  } catch {
    /* qo'llab-quvvatlanmaydi */
  }
};

export interface TelegramEnv {
  readonly initData: string;
  readonly startParam: string | null;
  readonly inTelegram: boolean;
}

export function initTelegram(): TelegramEnv {
  let inTelegram = false;
  try {
    inTelegram = isTMA();
  } catch {
    inTelegram = false;
  }
  if (!inTelegram) {
    return {
      initData: import.meta.env.DEV
        ? ((import.meta.env['VITE_DEV_INIT_DATA'] as string | undefined) ?? '')
        : '',
      startParam: null,
      inTelegram: false,
    };
  }
  safe(() => init());
  safe(() => themeParams.mountSync());
  safe(() => themeParams.bindCssVars());
  safe(() => miniApp.mountSync());
  safe(() => miniApp.bindCssVars());
  safe(() =>
    viewport.mount().then(() => {
      viewport.expand();
      viewport.bindCssVars();
    }),
  );
  safe(() => backButton.mount());
  safe(() => miniApp.ready());

  let initData = '';
  let startParam: string | null = null;
  try {
    initData = retrieveRawInitData() ?? '';
  } catch {
    initData = '';
  }
  try {
    startParam = (retrieveLaunchParams().tgWebAppStartParam as string | undefined) ?? null;
  } catch {
    startParam = null;
  }
  // Bot web_app tugmasi `?c=<mijoz-id>` bilan ochadi (startapp faqat havola orqali ishlaydi)
  const queryCustomer = new URLSearchParams(globalThis.location?.search ?? '').get('c');
  if (!startParam && queryCustomer) startParam = `c_${queryCustomer}`;
  return { initData, startParam, inTelegram: true };
}

export function haptic(kind: 'success' | 'error' | 'light'): void {
  safe(() => {
    if (kind === 'light') hapticFeedback.impactOccurred('light');
    else hapticFeedback.notificationOccurred(kind);
  });
}

/** Telegram havolasini ochadi (xodimga yuborish uchun share). Brauzerda yangi oynada. */
export function openLink(url: string): void {
  try {
    if (url.startsWith('https://t.me/')) {
      openTelegramLink(url);
      return;
    }
  } catch {
    /* pastga */
  }
  window.open(url, '_blank', 'noopener');
}

/** Telegram'ning "Orqaga" tugmasi: ichki sahifalarda ko'rinadi. */
export function useBackButton(enabled: boolean, onBack: () => void): void {
  useEffect(() => {
    if (!enabled) return;
    let off: VoidFunction | undefined;
    safe(() => {
      backButton.show();
      off = backButton.onClick(onBack);
    });
    return () => {
      safe(() => off?.());
      safe(() => backButton.hide());
    };
  }, [enabled, onBack]);
}
