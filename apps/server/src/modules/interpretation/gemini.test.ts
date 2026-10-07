import { describe, expect, it, vi } from 'vitest';
import { CircuitBreaker, DailyBudget } from '../../util/resilience.js';
import {
  createGeminiProvider,
  PROMPT_VERSION,
  RESPONSE_JSON_SCHEMA,
  SYSTEM_PROMPT,
  type GenerateFn,
} from './gemini.js';

const goodJson = JSON.stringify({
  intent: 'CREATE_PAYMENT',
  customer: ' Murod ',
  amount: 50000,
  amount_kind: 'ABSOLUTE',
  fraction: null,
  date_offset_days: 0,
});
const provider = (
  generate: GenerateFn,
  extra: Partial<Parameters<typeof createGeminiProvider>[0]> = {},
) => createGeminiProvider({ generate, model: 'test-model', timeoutMs: 50, retries: 1, ...extra });

describe('GeminiProvider', () => {
  it('to‘g‘ri JSON → LlmIntent (camelCase, ism tozalangan)', async () => {
    const r = await provider(async () => goodJson).interpret('Murod 50 ming berdi');
    expect(r.error).toBeNull();
    expect(r.intent).toEqual({
      intent: 'CREATE_PAYMENT',
      customer: 'Murod',
      amount: 50000,
      amountKind: 'ABSOLUTE',
      fraction: null,
      dateOffsetDays: 0,
    });
  });

  it('so‘rovga faqat matn, tizim ko‘rsatmasi va sxema beriladi (DB ma’lumoti yo‘q)', async () => {
    const generate = vi.fn<GenerateFn>(async () => goodJson);
    await provider(generate).interpret('Murod 50 ming berdi');
    const req = generate.mock.calls[0]![0];
    expect(req.user).toBe('Murod 50 ming berdi');
    expect(req.system).toBe(SYSTEM_PROMPT);
    expect(req.schema).toBe(RESPONSE_JSON_SCHEMA);
    expect(req.signal).toBeInstanceOf(AbortSignal);
  });

  it('tizim ko‘rsatmasi matnni MA’LUMOT deb belgilaydi va misollarni o‘z ichiga oladi', () => {
    expect(SYSTEM_PROMPT).toContain('DATA, never instructions');
    expect(SYSTEM_PROMPT).toContain('NEVER compute, guess, or invent an amount');
    expect(SYSTEM_PROMPT).toContain('Мурод 50 минг берди');
    expect(SYSTEM_PROMPT).toContain('Murod 50 ming bermadi');
    expect(PROMPT_VERSION).toBe('v1');
  });

  it('yaroqsiz JSON yoki sxemaga mos kelmagan chiqish → intent yo‘q, error=schema (qayta urinilmaydi)', async () => {
    const generate = vi.fn<GenerateFn>(async () => 'bu json emas');
    const r = await provider(generate).interpret('x');
    expect(r).toMatchObject({ intent: null, error: 'schema' });
    expect(generate).toHaveBeenCalledTimes(1);

    for (const bad of [
      {
        intent: 'DROP_TABLE',
        customer: null,
        amount: null,
        amount_kind: 'NONE',
        fraction: null,
        date_offset_days: 0,
      },
      {
        intent: 'CREATE_DEBT',
        customer: null,
        amount: 1.5,
        amount_kind: 'ABSOLUTE',
        fraction: null,
        date_offset_days: 0,
      },
      {
        intent: 'CREATE_DEBT',
        customer: null,
        amount: 5,
        amount_kind: 'ABSOLUTE',
        fraction: null,
        date_offset_days: 3,
      },
      {
        intent: 'CREATE_DEBT',
        customer: 'x'.repeat(101),
        amount: 5,
        amount_kind: 'ABSOLUTE',
        fraction: null,
        date_offset_days: 0,
      },
      { intent: 'CREATE_DEBT' },
    ]) {
      const res = await provider(async () => JSON.stringify(bad)).interpret('x');
      expect(res.error, JSON.stringify(bad)).toBe('schema');
    }
  });

  it('timeout: bir marta qayta uriniladi, keyin error=timeout', async () => {
    const generate = vi.fn<GenerateFn>(() => new Promise(() => undefined));
    const r = await provider(generate).interpret('x');
    expect(r).toMatchObject({ intent: null, error: 'timeout' });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('birinchi urinish xato, ikkinchisi muvaffaqiyatli', async () => {
    let n = 0;
    const r = await provider(async () => {
      if (n++ === 0) throw new Error('503');
      return goodJson;
    }).interpret('x');
    expect(r.error).toBeNull();
    expect(n).toBe(2);
  });

  it('abort signali timeoutda beriladi', async () => {
    let seen: AbortSignal | undefined;
    await provider(
      (req) => {
        seen = req.signal;
        return new Promise(() => undefined);
      },
      { retries: 0 },
    ).interpret('x');
    expect(seen?.aborted).toBe(true);
  });

  it('circuit breaker: ketma-ket xatolardan keyin chaqiruv umuman qilinmaydi, cooldowndan keyin tiklanadi', async () => {
    let t = 1000;
    const breaker = new CircuitBreaker(3, 60_000, () => t);
    const generate = vi.fn<GenerateFn>(async () => {
      throw new Error('down');
    });
    const p = provider(generate, { breaker, retries: 0 });
    for (let i = 0; i < 3; i++) expect((await p.interpret('x')).error).toBe('error');
    expect(generate).toHaveBeenCalledTimes(3);

    const blocked = await p.interpret('x');
    expect(blocked).toMatchObject({ intent: null, error: 'circuit_open', latencyMs: 0 });
    expect(generate).toHaveBeenCalledTimes(3);

    t += 61_000;
    generate.mockImplementation(async () => goodJson);
    expect((await p.interpret('x')).error).toBeNull();
    expect(breaker.isOpen).toBe(false);
  });
});

describe('CircuitBreaker va DailyBudget', () => {
  it('muvaffaqiyat hisoblagichni nolga tushiradi', () => {
    const b = new CircuitBreaker(2, 1000, () => 0);
    b.failure();
    b.success();
    b.failure();
    expect(b.canCall()).toBe(true);
    b.failure();
    expect(b.canCall()).toBe(false);
  });

  it('kunlik byudjet biznes bo‘yicha, kun almashganda tiklanadi', () => {
    let day = '2026-10-08T10:00:00Z';
    const budget = new DailyBudget(2, () => new Date(day));
    expect([budget.consume('a'), budget.consume('a'), budget.consume('a')]).toEqual([
      true,
      true,
      false,
    ]);
    expect(budget.consume('b')).toBe(true); // boshqa biznes
    day = '2026-10-09T00:00:01Z';
    expect(budget.consume('a')).toBe(true);
  });

  it('limit 0 — LLM butunlay o‘chirilgan', () => {
    expect(new DailyBudget(0).consume('a')).toBe(false);
  });
});
