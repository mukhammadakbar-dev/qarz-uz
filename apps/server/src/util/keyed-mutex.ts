/**
 * Bir xil kalit uchun vazifalarni ketma-ket bajaradi, turli kalitlar parallel ishlaydi.
 * Bir chat ichidagi update'lar tartibini ta'minlash uchun (ADR-0003). Bitta jarayon uchun;
 * bir nechta instance ishga tushirilsa, pg advisory lock ga o'tkaziladi.
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.tails.set(key, tail);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }

  /** Hozir navbat yoki bajarilish holatidagi kalitlar soni (test va metrika uchun). */
  get size(): number {
    return this.tails.size;
  }
}
