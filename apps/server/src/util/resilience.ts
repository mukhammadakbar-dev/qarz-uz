/** Tashqi xizmat (LLM) uchun chidamlilik vositalari. Vaqt tashqaridan beriladi (testlar uchun). */

export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly threshold = 5,
    private readonly cooldownMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** true: chaqirish mumkin. Ochiq bo'lsa cooldown tugagach bitta "yarim ochiq" urinishga ruxsat beradi. */
  canCall(): boolean {
    if (this.openedAt === null) return true;
    if (this.now() - this.openedAt >= this.cooldownMs) {
      this.openedAt = this.now(); // keyingi urinish yana cooldown kutadi (muvaffaqiyat bo'lmasa)
      return true;
    }
    return false;
  }

  success(): void {
    this.failures = 0;
    this.openedAt = null;
  }

  failure(): void {
    this.failures++;
    if (this.failures >= this.threshold) this.openedAt = this.now();
  }

  get isOpen(): boolean {
    return this.openedAt !== null;
  }
}

/** Biznes boshiga kunlik chaqiruvlar soni (jarayon xotirasida; UTC kun). */
export class DailyBudget {
  private readonly used = new Map<string, number>();
  private day: string;

  constructor(
    private readonly limit: number,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.day = this.today();
  }

  private today(): string {
    return this.now().toISOString().slice(0, 10);
  }

  /** Chaqiruvga ruxsat bor bo'lsa hisoblab true qaytaradi. */
  consume(key: string): boolean {
    const today = this.today();
    if (today !== this.day) {
      this.used.clear();
      this.day = today;
    }
    const n = this.used.get(key) ?? 0;
    if (n >= this.limit) return false;
    this.used.set(key, n + 1);
    return true;
  }
}
