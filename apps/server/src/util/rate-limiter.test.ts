import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limiter.js';

function setup(perMinute = 6, burst = 3) {
  let now = 1_000_000;
  const limiter = new RateLimiter({ perMinute, burst, now: () => now });
  return { limiter, advance: (ms: number) => (now += ms) };
}

describe('RateLimiter', () => {
  it('burst tagacha ruxsat, keyin birinchi marta limited-first, so‘ng jim limited', () => {
    const { limiter } = setup();
    expect(['a', 'a', 'a'].map((k) => limiter.take(k))).toEqual(['allow', 'allow', 'allow']);
    expect(limiter.take('a')).toBe('limited-first');
    expect(limiter.take('a')).toBe('limited');
    expect(limiter.take('b')).toBe('allow'); // kalitlar alohida
  });

  it('tokenlar vaqt bilan tiklanadi va ogohlantirish qayta yoqiladi', () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < 3; i++) limiter.take('a');
    expect(limiter.take('a')).toBe('limited-first');
    advance(10_000); // 6/daqiqa → 10 s da bitta token
    expect(limiter.take('a')).toBe('allow');
    expect(limiter.take('a')).toBe('limited-first');
    advance(10 * 60_000);
    expect(['a', 'a', 'a', 'a'].map((k) => limiter.take(k))).toEqual([
      'allow',
      'allow',
      'allow',
      'limited-first',
    ]);
  });

  it('to‘liq tiklangan chelaklar tozalanadi', () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < 100; i++) limiter.take(`u${i}`);
    expect(limiter.size).toBe(100);
    advance(2 * 60_000);
    limiter.take('yangi');
    expect(limiter.size).toBe(1);
  });
});
