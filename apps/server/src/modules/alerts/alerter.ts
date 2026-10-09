import type { Logger } from '../../observability/logger.js';

/**
 * Operator ogohlantirishlari (T6.3): superadmin(lar)ning Telegram chatiga. Maqsad — bot yoki server muammosini
 * foydalanuvchilardan oldin bilish. Xabarlarda foydalanuvchi matni, summa yoki shaxsiy ma'lumot bo'lmaydi.
 *
 *  - bir xil kalitli ogohlantirish `dedupeMs` (30 daqiqa) ichida bir martadan ko'p yuborilmaydi;
 *  - kutilmagan xatolar oynada sanaladi: `windowMs` (5 daqiqa) ichida `threshold` (5) taga yetsa — bitta ogohlantirish;
 *  - yuborish xatosi asosiy oqimni hech qachon buzmaydi (faqat log).
 */

export interface AlerterDeps {
  readonly send: (chatId: number, text: string) => Promise<unknown>;
  readonly chatIds: readonly number[];
  readonly logger: Logger;
  readonly now?: () => number;
  readonly dedupeMs?: number;
  readonly windowMs?: number;
  readonly threshold?: number;
}

/** Xato haqida faqat turi va kodi (xabar matni ma'lumot o'z ichiga olishi mumkin). */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' || typeof code === 'number'
      ? `${error.name} (${code})`
      : error.name;
  }
  return typeof error;
}

export class Alerter {
  private readonly lastSent = new Map<string, number>();
  private errors: number[] = [];
  private lastErrorKind = '';

  constructor(private readonly deps: AlerterDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** Yuborildimi (dedupe yoki chat yo'qligi sababli yuborilmasligi mumkin). */
  async notify(key: string, text: string): Promise<boolean> {
    if (this.deps.chatIds.length === 0) return false;
    const now = this.now();
    const last = this.lastSent.get(key);
    if (last !== undefined && now - last < (this.deps.dedupeMs ?? 30 * 60_000)) return false;
    this.lastSent.set(key, now);
    await Promise.all(
      this.deps.chatIds.map((chatId) =>
        this.deps
          .send(chatId, text)
          .catch((error: unknown) =>
            this.deps.logger.warn({ err: error, key }, 'ogohlantirish yuborilmadi'),
          ),
      ),
    );
    return true;
  }

  /** Kutilmagan xato: oynadagi soni chegaraga yetsa ogohlantiradi. */
  recordError(error: unknown): void {
    const now = this.now();
    const windowMs = this.deps.windowMs ?? 5 * 60_000;
    this.errors = this.errors.filter((t) => now - t < windowMs);
    this.errors.push(now);
    this.lastErrorKind = describeError(error);
    const threshold = this.deps.threshold ?? 5;
    if (this.errors.length >= threshold) {
      void this.notify(
        'errors',
        `⚠️ Kissa: ${Math.round(windowMs / 60_000)} daqiqada ${this.errors.length} ta kutilmagan xato.\n` +
          `Oxirgisi: ${this.lastErrorKind}\nLoglar: pm2 logs nasiya`,
      );
    }
  }
}
