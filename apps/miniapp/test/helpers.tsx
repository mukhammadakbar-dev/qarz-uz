import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import type { ApiClient } from '../src/lib/api';
import { I18nProvider } from '../src/lib/i18n';
import type { Customer, HistoryItem, Locale, Me, Role } from '../src/lib/types';
import { SessionContext, type Session } from '../src/state/session';

/** Soxta API: har bir metod vi.fn(); testlar kerakli javobni beradi. */
const API_NAMES = [
  'me',
  'switchBusiness',
  'dashboard',
  'customers',
  'customer',
  'createCustomer',
  'updateCustomer',
  'archive',
  'unarchive',
  'ledger',
  'preview',
  'addEntry',
  'deleteEntry',
  'staff',
  'invite',
  'revoke',
  'business',
  'updateBusiness',
  'billing',
] as const;
export type FakeApi = Record<(typeof API_NAMES)[number], ReturnType<typeof vi.fn>> & {
  businessId: string | null;
};

export function fakeApi(overrides: Record<string, unknown> = {}): FakeApi {
  const api: Record<string, unknown> = { businessId: 'biz-1' };
  for (const n of API_NAMES) api[n] = vi.fn();
  return Object.assign(api, overrides) as FakeApi;
}

export const customer = (over: Partial<Customer> = {}): Customer => ({
  id: 'c1',
  name: 'Murod',
  label: null,
  phone: null,
  notes: null,
  status: 'ACTIVE',
  balance: 450000,
  createdAt: '2026-10-07T10:00:00Z',
  updatedAt: '2026-10-07T10:00:00Z',
  ...over,
});

export const entry = (over: Partial<HistoryItem> = {}): HistoryItem => ({
  id: 'e1',
  seq: 1,
  type: 'DEBT',
  amount: 450000,
  delta: 450000,
  description: null,
  occurredAt: '2026-10-07T10:00:00Z',
  createdAt: '2026-10-07T10:00:00Z',
  runningBalance: 450000,
  reversedBy: null,
  isReversal: false,
  createdByName: 'Akbar',
  ...over,
});

export function session(api: FakeApi, role: Role = 'OWNER', locale: Locale = 'uz-Latn'): Session {
  const me: Me = {
    user: { id: 'u1', firstName: 'Akbar', username: null, locale },
    activeBusinessId: 'biz-1',
    businesses: [{ id: 'biz-1', name: 'Baraka', role }],
  };
  return {
    api: api as unknown as ApiClient,
    me,
    businessId: 'biz-1',
    role,
    locale,
    switchBusiness: vi.fn(async () => undefined),
  };
}

export function renderApp(
  ui: ReactElement,
  options: { api: FakeApi; role?: Role; locale?: Locale; route?: string; path?: string },
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const s = session(options.api, options.role, options.locale);
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider locale={s.locale}>
        <SessionContext.Provider value={s}>
          <MemoryRouter initialEntries={[options.route ?? '/']}>
            <Routes>
              <Route path={options.path ?? '*'} element={ui} />
              <Route path="*" element={<div data-testid="elsewhere" />} />
            </Routes>
          </MemoryRouter>
        </SessionContext.Provider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}
