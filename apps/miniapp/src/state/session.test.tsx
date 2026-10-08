import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { App } from '../App';
import { ApiError, type ApiClient } from '../lib/api';
import type { Me } from '../lib/types';
import { fakeApi } from '../../test/helpers';
import { SessionProvider } from './session';

const me = (over: Partial<Me> = {}): Me => ({
  user: { id: 'u1', firstName: 'Akbar', username: null, locale: 'uz-Latn' },
  activeBusinessId: 'b1',
  businesses: [{ id: 'b1', name: 'Baraka', role: 'OWNER' }],
  ...over,
});

function mount(api: ReturnType<typeof fakeApi>, startParam: string | null = null, route = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.dashboard.mockResolvedValue({
    business: { id: 'b1', name: 'Baraka' },
    role: 'OWNER',
    summary: { totalDebt: 0, debtorsCount: 0, todayOperations: 0 },
    subscription: { state: 'ACTIVE', until: '2026-12-01T00:00:00Z', daysLeft: 40 },
  });
  api.customers.mockResolvedValue({ items: [], nextCursor: null });
  api.customer.mockResolvedValue({
    id: 'c',
    name: 'Deep',
    label: null,
    phone: null,
    notes: null,
    status: 'ACTIVE',
    balance: 0,
    createdAt: '',
    updatedAt: '',
  });
  api.ledger.mockResolvedValue({ items: [], nextCursor: null });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <SessionProvider api={api as unknown as ApiClient}>
          <App startParam={startParam} />
        </SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SessionProvider darvozasi', () => {
  it('yuklanish → ilova; X-Business-Id sozlanadi', async () => {
    const api = fakeApi();
    api.me.mockResolvedValue(me());
    mount(api);
    expect(screen.getByText('Yuklanmoqda…')).toBeInTheDocument();
    expect(await screen.findByTestId('total-debt')).toBeInTheDocument();
    expect(api.businessId).toBe('b1');
  });

  it('autentifikatsiya muvaffaqiyatsiz (Telegramdan tashqari): tushuntirish, qayta urinish tugmasisiz', async () => {
    const api = fakeApi();
    api.me.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'x'));
    mount(api);
    expect(await screen.findByText('Bu ilovani Telegram ichida oching.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Qayta urinish' })).not.toBeInTheDocument();
  });

  it('tarmoq xatosi: qayta urinish', async () => {
    const api = fakeApi();
    api.me.mockRejectedValueOnce(new TypeError('x')).mockResolvedValue(me());
    const user = userEvent.setup();
    mount(api);
    await user.click(await screen.findByRole('button', { name: 'Qayta urinish' }));
    expect(await screen.findByTestId('total-debt')).toBeInTheDocument();
  });

  it('biznesi yo‘q foydalanuvchi: botda /start bosish kerak', async () => {
    const api = fakeApi();
    api.me.mockResolvedValue(me({ businesses: [], activeBusinessId: null }));
    mount(api);
    expect(
      await screen.findByText('Avval botda /start bosib, biznes yarating.'),
    ).toBeInTheDocument();
  });

  it('bir nechta biznes, hech biri tanlanmagan: tanlash ekrani; tanlov serverga yuboriladi', async () => {
    const api = fakeApi();
    api.me.mockResolvedValue(
      me({
        activeBusinessId: null,
        businesses: [
          { id: 'b1', name: 'Baraka', role: 'OWNER' },
          { id: 'b2', name: 'Ikkinchi', role: 'STAFF' },
        ],
      }),
    );
    api.switchBusiness.mockResolvedValue({ activeBusinessId: 'b2' });
    const user = userEvent.setup();
    mount(api);
    await user.click(await screen.findByRole('button', { name: 'Ikkinchi' }));
    expect(api.switchBusiness).toHaveBeenCalledWith('b2');
    await waitFor(() => expect(api.businessId).toBe('b2'));
  });

  it('serverdan kelgan faol biznes ro‘yxatda bo‘lmasa e’tiborsiz (eskirgan a’zolik)', async () => {
    const api = fakeApi();
    api.me.mockResolvedValue(
      me({ activeBusinessId: 'gone', businesses: [{ id: 'b1', name: 'Baraka', role: 'OWNER' }] }),
    );
    mount(api);
    await screen.findByTestId('total-debt');
    expect(api.businessId).toBe('b1');
  });

  it('Kirill: foydalanuvchi tili serverdan olinadi', async () => {
    const api = fakeApi();
    api.me.mockResolvedValue(
      me({ user: { id: 'u', firstName: 'A', username: null, locale: 'uz-Cyrl' } }),
    );
    mount(api);
    expect(await screen.findByText('Жами қарз')).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('uz-Cyrl');
  });
});

describe('superadmin', () => {
  const stats = {
    businesses: 3,
    trial: 1,
    active: 1,
    expired: 1,
    suspended: 0,
    expiringSoon: 0,
    newThisWeek: 1,
    users: 5,
    customers: 10,
    totalDebt: 1000,
    entriesToday: 2,
    revenueThisMonth: 29000,
  };

  it('do‘koni yo‘q superadmin faqat panelni ko‘radi', async () => {
    const api = fakeApi();
    api.me.mockResolvedValue(me({ businesses: [], activeBusinessId: null, isSuperadmin: true }));
    api.adminStats.mockResolvedValue(stats);
    api.adminBusinesses.mockResolvedValue({ items: [], nextCursor: null });
    mount(api);
    expect(await screen.findByRole('heading', { name: 'Admin panel' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation');
    expect(nav).toHaveTextContent('Admin');
    expect(nav).not.toHaveTextContent('Daftar');
    expect(api.dashboard).not.toHaveBeenCalled();
  });

  it('do‘koni bor superadmin: uchinchi “Admin” tabi; oddiy foydalanuvchida yo‘q, /admin ga kira olmaydi', async () => {
    const api = fakeApi();
    api.me.mockResolvedValue(me({ isSuperadmin: true }));
    const view = mount(api);
    expect(await screen.findByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
    view.unmount();

    const plain = fakeApi();
    plain.me.mockResolvedValue(me());
    mount(plain, null, '/admin');
    expect(await screen.findByTestId('total-debt')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
    expect(plain.adminStats).not.toHaveBeenCalled();
  });
});

describe('App: chuqur havola va rol himoyasi', () => {
  const uuid = '123e4567-e89b-12d3-a456-426614174000';

  it('startapp=c_<uuid> mijoz sahifasini ochadi', async () => {
    const api = fakeApi();
    api.me.mockResolvedValue(me());
    mount(api, `c_${uuid}`);
    await waitFor(() => expect(api.customer).toHaveBeenCalledWith(uuid));
  });

  it('noto‘g‘ri startapp e’tiborsiz qoldiriladi (mijoz so‘rovi yo‘q)', async () => {
    const api = fakeApi();
    api.me.mockResolvedValue(me());
    mount(api, "c_'; DROP TABLE x;--");
    await screen.findByTestId('total-debt');
    expect(api.customer).not.toHaveBeenCalled();
  });

  it('xodim eski /staff manzilidan Biznes sahifasiga o‘tadi, xodimlar ro‘yxati so‘ralmaydi', async () => {
    const api = fakeApi();
    api.me.mockResolvedValue(me({ businesses: [{ id: 'b1', name: 'Baraka', role: 'STAFF' }] }));
    mount(api, null, '/staff');
    expect(await screen.findByRole('region', { name: 'Obuna' })).toBeInTheDocument();
    expect(api.staff).not.toHaveBeenCalled();
    expect(api.billing).not.toHaveBeenCalled();
  });

  it('eski /customers manzili Daftarga olib keladi', async () => {
    const api = fakeApi();
    api.me.mockResolvedValue(me());
    mount(api, null, '/customers');
    expect(await screen.findByTestId('total-debt')).toBeInTheDocument();
  });
});
