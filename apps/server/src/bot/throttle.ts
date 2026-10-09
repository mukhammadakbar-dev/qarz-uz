import type { Transformer } from 'grammy';

export interface Retry429Options {
  /** Bitta so'rov uchun jami kutish chegarasi: webhook ishlovi uzoq osilib qolmasin (Telegram qayta yuboradi). */
  readonly maxWaitMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Telegram API transformeri (T6.2): 429 (`Too Many Requests`) bo'lsa `retry_after` ni kutib qayta yuboradi.
 * Kutish jami `maxWaitMs` dan oshsa, xato chaqiruvchiga qaytadi (broadcast/eslatmalar o'zi qayta urinadi).
 */
export function retryOn429(options: Retry429Options = {}): Transformer {
  const maxWaitMs = options.maxWaitMs ?? 10_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  return async (prev, method, payload, signal) => {
    let waited = 0;
    for (;;) {
      const res = await prev(method, payload, signal);
      if (res.ok || res.error_code !== 429) return res;
      const waitMs = (res.parameters?.retry_after ?? 1) * 1000;
      if (waited + waitMs > maxWaitMs) return res;
      waited += waitMs;
      await sleep(waitMs);
    }
  };
}
