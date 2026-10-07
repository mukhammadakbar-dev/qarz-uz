import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from './api';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return handler(String(url), init ?? {});
  }) as unknown as typeof fetch;
  const api = new ApiClient({ getInitData: () => 'INIT', fetchImpl });
  return { api, calls };
}
const headersOf = (c: { init: RequestInit }) => c.init.headers as Record<string, string>;

describe('ApiClient', () => {
  it('birinchi so‘rovdan oldin initData bilan kiradi va Bearer token yuboradi', async () => {
    const { api, calls } = setup((url) =>
      url === '/api/auth/telegram' ? json(200, { token: 'T1' }) : json(200, { ok: 1 }),
    );
    await api.dashboard();
    expect(calls.map((c) => c.url)).toEqual(['/api/auth/telegram', '/api/dashboard']);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ initData: 'INIT' });
    expect(headersOf(calls[1]!)['authorization']).toBe('Bearer T1');
  });

  it('parallel so‘rovlar bitta autentifikatsiyaga birlashadi, token qayta ishlatiladi', async () => {
    const { api, calls } = setup((url) =>
      url === '/api/auth/telegram' ? json(200, { token: 'T' }) : json(200, {}),
    );
    await Promise.all([api.dashboard(), api.me(), api.business()]);
    await api.billing();
    expect(calls.filter((c) => c.url === '/api/auth/telegram')).toHaveLength(1);
  });

  it('401 olinsa qayta kiradi va so‘rovni bir marta takrorlaydi', async () => {
    let tokens = 0;
    let seen401 = false;
    const { api, calls } = setup((url, init) => {
      if (url === '/api/auth/telegram') return json(200, { token: `T${++tokens}` });
      if (headersOf({ init })['authorization'] === 'Bearer T1' && !seen401) {
        seen401 = true;
        return json(401, { code: 'UNAUTHORIZED', message: 'eskirgan' });
      }
      return json(200, { ok: true });
    });
    await expect(api.dashboard()).resolves.toEqual({ ok: true });
    expect(calls.map((c) => c.url)).toEqual([
      '/api/auth/telegram',
      '/api/dashboard',
      '/api/auth/telegram',
      '/api/dashboard',
    ]);
    expect(headersOf(calls[3]!)['authorization']).toBe('Bearer T2');
  });

  it('qayta kirgandan keyin ham 401 bo‘lsa ApiError', async () => {
    const { api } = setup((url) =>
      url === '/api/auth/telegram'
        ? json(200, { token: 'T' })
        : json(401, { code: 'UNAUTHORIZED', message: 'x' }),
    );
    await expect(api.dashboard()).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
  });

  it('X-Business-Id va Idempotency-Key sarlavhalari, JSON tana', async () => {
    const { api, calls } = setup((url) =>
      url === '/api/auth/telegram' ? json(200, { token: 'T' }) : json(201, { balance: 1 }),
    );
    api.businessId = 'biz-9';
    await api.addEntry('c1', 'debt', { amount: 5000 }, 'key-12345678');
    const call = calls.at(-1)!;
    expect(call.url).toBe('/api/customers/c1/debts');
    expect(headersOf(call)).toMatchObject({
      'x-business-id': 'biz-9',
      'idempotency-key': 'key-12345678',
      'content-type': 'application/json',
    });
    expect(JSON.parse(call.init.body as string)).toEqual({ amount: 5000 });
  });

  it('to‘lov uchun /payments, o‘chirish uchun /api/entries/:id/delete', async () => {
    const { api, calls } = setup((url) =>
      url === '/api/auth/telegram' ? json(200, { token: 'T' }) : json(200, { balance: 0 }),
    );
    await api.addEntry('c1', 'payment', { amount: 1 }, 'key-12345678');
    await api.deleteEntry('e1', 'xato', 'key-87654321');
    expect(calls.map((c) => c.url).slice(1)).toEqual([
      '/api/customers/c1/payments',
      '/api/entries/e1/delete',
    ]);
  });

  it('so‘rov parametrlari: aniqlanmagan va bo‘sh qiymatlar tushiriladi', async () => {
    const { api, calls } = setup((url) =>
      url === '/api/auth/telegram'
        ? json(200, { token: 'T' })
        : json(200, { items: [], nextCursor: null }),
    );
    await api.customers({ q: 'murod', sort: 'debt', debtors: true });
    await api.customers({ q: '' });
    expect(calls[1]!.url).toBe('/api/customers?q=murod&sort=debt&debtors=true');
    expect(calls[2]!.url).toBe('/api/customers');
  });

  it('xato javobi code/message/details va reason bilan ApiError', async () => {
    const { api } = setup((url) =>
      url === '/api/auth/telegram'
        ? json(200, { token: 'T' })
        : json(409, {
            code: 'CONFLICT',
            message: 'band',
            details: { reason: 'LABEL_REQUIRED', existing: 1 },
          }),
    );
    const err = await api.createCustomer({ name: 'Ali' }, 'key-12345678').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'CONFLICT', reason: 'LABEL_REQUIRED' });
  });

  it('autentifikatsiya muvaffaqiyatsiz bo‘lsa so‘rov yuborilmaydi', async () => {
    const { api, calls } = setup(() => json(401, { code: 'UNAUTHORIZED', message: 'yaroqsiz' }));
    await expect(api.dashboard()).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(1);
  });

  it('tarmoq xatosi TypeError sifatida qoladi (UI “internet yo‘q” deydi)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const api = new ApiClient({ getInitData: () => 'I', fetchImpl });
    await expect(api.dashboard()).rejects.toBeInstanceOf(TypeError);
  });
});
