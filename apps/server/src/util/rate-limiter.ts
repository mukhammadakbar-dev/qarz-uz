/**
 * Kalit bo'yicha token bucket (T6.2): har foydalanuvchiga daqiqasiga `perMinute` ta, birdaniga `burst` tagacha.
 * Bitta jarayon uchun (ADR-0001: bitta PM2 instance). Eskirgan kalitlar vaqti-vaqti bilan tozalanadi.
 */
export interface RateLimiterOptions {
  readonly perMinute: number;
  readonly burst: number;
  readonly now?: () => number;
}

export type RateDecision =
  /** Ruxsat. */
  | 'allow'
  /** Chegaradan oshdi — birinchi marta (foydalanuvchiga bir marta aytish uchun). */
  | 'limited-first'
  /** Chegaradan oshdi — jim e'tiborsiz. */
  | 'limited';

interface Bucket {
  tokens: number;
  updatedAt: number;
  warned: boolean;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = 0;

  constructor(private readonly options: RateLimiterOptions) {}

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  take(key: string): RateDecision {
    const now = this.now();
    const ratePerMs = this.options.perMinute / 60_000;
    const b = this.buckets.get(key) ?? {
      tokens: this.options.burst,
      updatedAt: now,
      warned: false,
    };
    b.tokens = Math.min(this.options.burst, b.tokens + (now - b.updatedAt) * ratePerMs);
    b.updatedAt = now;
    this.buckets.set(key, b);
    this.sweep(now);
    if (b.tokens >= 1) {
      b.tokens -= 1;
      b.warned = false;
      return 'allow';
    }
    if (b.warned) return 'limited';
    b.warned = true;
    return 'limited-first';
  }

  /** To'lgan (to'liq tiklangan) chelaklarni olib tashlaydi: xotira foydalanuvchi soniga qarab o'smasin. */
  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    const fullAfterMs = (this.options.burst / this.options.perMinute) * 60_000;
    for (const [key, b] of this.buckets)
      if (now - b.updatedAt > fullAfterMs) this.buckets.delete(key);
  }

  get size(): number {
    return this.buckets.size;
  }
}
