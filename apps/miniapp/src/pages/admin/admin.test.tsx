import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { customer, entry, fakeApi, renderApp } from '../../../test/helpers';
import { AdminBroadcast } from './AdminBroadcast';
import { AdminCustomer } from './AdminCustomer';
import { AdminHome } from './AdminHome';
import { AdminShop } from './AdminShop';

const KEY = /^[0-9a-f-]{36}$/;
const shopRow = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  name: 'Baraka',
  shortCode: 'TD-AB2CD',
  createdAt: '2026-10-01T10:00:00Z',
  suspendedAt: null,
  suspendedReason: null,
  owner: { userId: 'o1', telegramUserId: 840000001, username: 'baraka_ega', name: 'Akmal' },
  subscription: { state: 'TRIAL', until: '2026-10-15T10:00:00Z', daysLeft: 7 },
  customers: 12,
  totalDebt: 3450000,
  staff: 1,
  lastEntryAt: '2026-10-08T09:00:00Z',
  ...over,
});
const stats = {
  businesses: 42,
  trial: 10,
  active: 25,
  expired: 7,
  suspended: 1,
  expiringSoon: 3,
  newThisWeek: 4,
  users: 60,
  customers: 900,
  totalDebt: 125000000,
  entriesToday: 87,
  revenueThisMonth: 725000,
};

describe('AdminHome', () => {
  it('statistika va do‘konlar ro‘yxati; qidiruv va filtr', async () => {
    const api = fakeApi();
    api.adminStats.mockResolvedValue(stats);
    api.adminBusinesses.mockResolvedValue({ items: [shopRow()], nextCursor: null });
    const user = userEvent.setup();
    renderApp(<AdminHome />, { api, superadmin: true, path: '/' });

    expect(await screen.findByText('Shu oy tushum')).toBeInTheDocument();
    expect(screen.getByText('725 000 so‘m')).toBeInTheDocument();
    const row = await screen.findByRole('link', { name: /Baraka/ });
    expect(row).toHaveAttribute('href', '/admin/shops/s1');
    expect(row).toHaveTextContent('@baraka_ega · 12 mijoz · 3 450 000 so‘m');
    expect(within(row).getByText('Sinov · 7 kun')).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox'), 'TD-AB');
    await waitFor(
      () => expect(api.adminBusinesses).toHaveBeenLastCalledWith({ q: 'TD-AB', limit: 30 }),
      { timeout: 2000 },
    );
    await user.click(screen.getByRole('button', { name: 'Bloklangan' }));
    await waitFor(() =>
      expect(api.adminBusinesses).toHaveBeenLastCalledWith({
        q: 'TD-AB',
        filter: 'SUSPENDED',
        limit: 30,
      }),
    );
  });
});

describe('AdminShop', () => {
  const detail = (over: Record<string, unknown> = {}) => ({
    ...shopRow(),
    entries: 140,
    priceUzs: 29000,
    members: [
      {
        userId: 'o1',
        telegramUserId: 1,
        username: 'baraka_ega',
        name: 'Akmal',
        role: 'OWNER',
        status: 'ACTIVE',
        joinedAt: '2026-10-01T10:00:00Z',
      },
      {
        userId: 'u2',
        telegramUserId: 2,
        username: null,
        name: 'Dilnoza',
        role: 'STAFF',
        status: 'ACTIVE',
        joinedAt: '2026-10-03T10:00:00Z',
      },
    ],
    payments: [],
    ...over,
  });
  const setup = (over: Record<string, unknown> = {}) => {
    const api = fakeApi();
    api.adminBusiness.mockResolvedValue(detail(over));
    api.adminCustomers.mockResolvedValue({
      items: [customer({ id: 'c1', name: 'Murod', balance: 850000 })],
      nextCursor: null,
    });
    api.adminExtend.mockResolvedValue({
      paidUntil: '2027-01-15T10:00:00Z',
      periodFrom: '2026-10-15T10:00:00Z',
    });
    api.adminSuspend.mockResolvedValue({ suspendedAt: '2026-10-08T10:00:00Z' });
    api.adminUnsuspend.mockResolvedValue({ suspendedAt: null });
    renderApp(<AdminShop />, {
      api,
      superadmin: true,
      route: '/admin/shops/s1',
      path: '/admin/shops/:id',
    });
    return { api, user: userEvent.setup() };
  };

  it('ega, a’zolar, faqat-ko‘rish ogohlantirishi va mijozlar', async () => {
    setup();
    expect(await screen.findByRole('heading', { name: 'Baraka' })).toBeInTheDocument();
    expect(screen.getByText(/Faqat ko‘rish/)).toBeInTheDocument();
    expect(screen.getByText('Akmal (@baraka_ega)')).toBeInTheDocument();
    expect(screen.getByText('Dilnoza')).toBeInTheDocument();
    expect(screen.getByText('Hali to‘lov qayd etilmagan')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /Murod/ })).toHaveAttribute(
      'href',
      '/admin/shops/s1/customers/c1',
    );
  });

  it('uzaytirish: oy tanlansa summa narx×oy; Idempotency-Key bilan yuboriladi', async () => {
    const { api, user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Obunani uzaytirish' }));
    const dialog = await screen.findByRole('dialog', { name: 'Obunani uzaytirish' });
    await user.click(within(dialog).getByRole('button', { name: '3 oy' }));
    expect(within(dialog).getByLabelText('Olingan summa (so‘m)')).toHaveValue('87 000');
    await user.type(within(dialog).getByLabelText('Izoh (ixtiyoriy)'), 'Click orqali');
    await user.click(within(dialog).getByRole('button', { name: /3 oyga uzaytirish/ }));
    await waitFor(() =>
      expect(api.adminExtend).toHaveBeenCalledWith(
        's1',
        { months: 3, amount: 87000, note: 'Click orqali' },
        expect.stringMatching(KEY),
      ),
    );
    expect(await screen.findByText('Uzaytirildi: 15.01.2027 gacha')).toBeInTheDocument();
  });

  it('bloklash sabab bilan; bloklangan do‘konda “Blokdan chiqarish”', async () => {
    const { api, user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Bloklash' }));
    const dialog = await screen.findByRole('dialog', { name: 'Do‘konni bloklash' });
    await user.type(within(dialog).getByLabelText('Sabab (egasiga ko‘rsatiladi)'), 'to‘lanmagan');
    await user.click(within(dialog).getByRole('button', { name: 'Bloklash' }));
    await waitFor(() => expect(api.adminSuspend).toHaveBeenCalledWith('s1', 'to‘lanmagan'));
  });

  it('bloklangan do‘kon', async () => {
    const { api, user } = setup({ suspendedAt: '2026-10-08T10:00:00Z', suspendedReason: 'qarz' });
    expect(await screen.findByText('Bloklangan: 08.10.2026 — qarz')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Blokdan chiqarish' }));
    await waitFor(() => expect(api.adminUnsuspend).toHaveBeenCalledWith('s1'));
  });
});

describe('AdminCustomer', () => {
  it('mijoz va tarix faqat ko‘rish uchun: o‘chirish yoki qo‘shish tugmalari yo‘q', async () => {
    const api = fakeApi();
    api.adminCustomer.mockResolvedValue(customer({ name: 'Murod', balance: 450000 }));
    api.adminLedger.mockResolvedValue({ items: [entry()], nextCursor: null });
    renderApp(<AdminCustomer />, {
      api,
      superadmin: true,
      route: '/admin/shops/s1/customers/c1',
      path: '/admin/shops/:id/customers/:customerId',
    });
    expect(await screen.findByTestId('balance')).toHaveAccessibleName('450 000 so‘m');
    expect(await screen.findAllByRole('listitem')).toHaveLength(1);
    expect(api.adminLedger).toHaveBeenCalledWith('s1', 'c1', { limit: 30 });
    // Faqat "Orqaga" tugmasi
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Orqaga',
    ]);
  });
});

describe('AdminBroadcast', () => {
  const setup = () => {
    const api = fakeApi();
    api.adminBroadcastPreview.mockImplementation(
      async (a: { segments: string[]; includeStaff: boolean }) => ({
        recipients: a.segments.length * 10 + (a.includeStaff ? 5 : 0),
      }),
    );
    api.adminBroadcasts.mockResolvedValue({
      items: [
        {
          id: 'b1',
          text: 'Oldingi xabar',
          segments: ['ACTIVE'],
          includeStaff: false,
          status: 'DONE',
          total: 20,
          sent: 18,
          failed: 1,
          blocked: 1,
          createdAt: '2026-10-07T10:00:00Z',
          finishedAt: '2026-10-07T10:01:00Z',
          createdBy: 'Admin',
        },
      ],
    });
    api.adminBroadcast.mockResolvedValue({ id: 'b2', total: 25 });
    renderApp(<AdminBroadcast />, { api, superadmin: true, path: '/' });
    return { api, user: userEvent.setup() };
  };

  it('qabul qiluvchilar soni guruh va xodimlarga qarab o‘zgaradi; tarix statistikasi', async () => {
    const { api, user } = setup();
    expect(await screen.findByText('30 kishiga boradi')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Obunasi tugaganlar' }));
    expect(await screen.findByText('20 kishiga boradi')).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Xodimlarga ham yuborish' }));
    expect(await screen.findByText('25 kishiga boradi')).toBeInTheDocument();
    expect(api.adminBroadcastPreview).toHaveBeenLastCalledWith({
      segments: ['TRIAL', 'ACTIVE'],
      includeStaff: true,
    });
    expect(screen.getByText('18/20 yetkazildi · 1 bloklagan · 1 xato')).toBeInTheDocument();
  });

  it('matnsiz yuborib bo‘lmaydi; tasdiqdan keyin bitta kalit bilan yuboriladi', async () => {
    const { api, user } = setup();
    await screen.findByText('30 kishiga boradi');
    expect(screen.getByRole('button', { name: 'Yuborish' })).toBeDisabled();
    await user.type(screen.getByLabelText('Xabar matni'), '  Yangi funksiya!  ');
    await user.click(screen.getByRole('button', { name: 'Yuborish' }));
    const dialog = await screen.findByRole('dialog', { name: 'Yuborishni tasdiqlang' });
    expect(dialog).toHaveTextContent('Xabar 30 kishiga yuboriladi.');
    await user.click(within(dialog).getByRole('button', { name: 'Ha, 30 kishiga yuborish' }));
    await waitFor(() =>
      expect(api.adminBroadcast).toHaveBeenCalledWith(
        { text: 'Yangi funksiya!', segments: ['TRIAL', 'ACTIVE', 'EXPIRED'], includeStaff: false },
        expect.stringMatching(KEY),
      ),
    );
    expect(await screen.findByText('Yuborish boshlandi')).toBeInTheDocument();
    expect(api.adminBroadcast).toHaveBeenCalledTimes(1);
  });

  it('hech bir guruh tanlanmasa yuborib bo‘lmaydi', async () => {
    const { user } = setup();
    await screen.findByText('30 kishiga boradi');
    await user.type(screen.getByLabelText('Xabar matni'), 'Salom');
    for (const name of ['Sinovdagilar', 'Faol obunachilar', 'Obunasi tugaganlar'])
      await user.click(screen.getByRole('button', { name }));
    expect(screen.getByText('Tanlangan guruhda hech kim yo‘q')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yuborish' })).toBeDisabled();
  });
});
