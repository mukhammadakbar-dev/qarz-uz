import { describe, expect, it } from 'vitest';
import { KeyedMutex } from './keyed-mutex.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('KeyedMutex', () => {
  it('bir kalit ichida vazifalar ketma-ket va kelish tartibida bajariladi', async () => {
    const m = new KeyedMutex();
    const log: string[] = [];
    const task = (name: string, ms: number) =>
      m.run('chat', async () => {
        log.push(`start ${name}`);
        await sleep(ms);
        log.push(`end ${name}`);
      });
    await Promise.all([task('a', 30), task('b', 5), task('c', 1)]);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });

  it('turli kalitlar parallel ishlaydi', async () => {
    const m = new KeyedMutex();
    let active = 0;
    let maxActive = 0;
    const task = (key: string) =>
      m.run(key, async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await sleep(20);
        active--;
      });
    await Promise.all([task('1'), task('2'), task('3')]);
    expect(maxActive).toBe(3);
  });

  it('xato keyingi vazifani to‘xtatmaydi va kalit tozalanadi', async () => {
    const m = new KeyedMutex();
    const failing = m.run('k', async () => {
      throw new Error('boom');
    });
    const next = m.run('k', async () => 'ok');
    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
    expect(m.size).toBe(0);
  });
});
