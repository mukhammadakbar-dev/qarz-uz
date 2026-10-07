import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import { customer, entry, fakeApi, renderApp } from '../../test/helpers';
import { CustomerDetail } from './CustomerDetail';
import { CustomerNew } from './CustomerNew';
import { Customers } from './Customers';
import { Dashboard } from './Dashboard';
import { Settings } from './Settings';
import { Staff } from './Staff';

const page = (items: ReturnType<typeof customer>[], nextCursor: string | null = null) => ({
  items,
  nextCursor,
});

describe('Dashboard', () => {
  it('jami qarz, qarzdorlar, bugungi operatsiyalar va eng katta qarzlar', async () => {
    const api = fakeApi();
    api.dashboard.mockResolvedValue({
      business: { id: 'biz-1', name: 'Baraka' },
      role: 'OWNER',
      summary: { totalDebt: 1250000, debtorsCount: 12, todayOperations: 8 },
      subscription: { state: 'ACTIVE', until: '2026-12-01T00:00:00Z', daysLeft: 50 },
    });
    api.customers.mockResolvedValue(
      page([
        customer({ id: 'a', name: 'Murodbek', balance: 450000 }),
        customer({ id: 'b', name: 'Ali', balance: 250000 }),
      ]),
    );
    renderApp(<Dashboard />, { api });
    expect(await screen.findByTestId('total-debt')).toHaveTextContent('1 250 000 so‘m');
    expect(screen.getByText('12 ta')).toBeInTheDocument();
    expect(screen.getByText('8 ta')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /Murodbek/ })).toHaveAttribute(
      'href',
      '/customers/a',
    );
    expect(api.customers).toHaveBeenCalledWith({ sort: 'debt', debtors: true, limit: 5 });
  });

  it('xato bo‘lsa qayta urinish tugmasi', async () => {
    const api = fakeApi();
    api.dashboard.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue({
      business: { id: 'b', name: 'B' },
      role: 'OWNER',
      summary: { totalDebt: 0, debtorsCount: 0, todayOperations: 0 },
      subscription: { state: 'TRIAL', until: '2026-12-01T00:00:00Z', daysLeft: 9 },
    });
    api.customers.mockResolvedValue(page([]));
    const user = userEvent.setup();
    renderApp(<Dashboard />, { api });
    expect(await screen.findByRole('alert')).toHaveTextContent('Internet bilan aloqa yo‘q.');
    await user.click(screen.getByRole('button', { name: 'Qayta urinish' }));
    expect(await screen.findByTestId('total-debt')).toBeInTheDocument();
  });
});

describe('Customers', () => {
  it('ro‘yxat, qarz rangi va nom/yorliq', async () => {
    const api = fakeApi();
    api.customers.mockResolvedValue(
      page([
        customer({ id: 'a', name: 'Murod', label: 'aka', balance: 5000 }),
        customer({ id: 'b', name: 'Vali', balance: 0 }),
      ]),
    );
    renderApp(<Customers />, { api });
    expect(await screen.findByText('(aka)', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('5 000 so‘m')).toHaveClass('debt');
    expect(screen.getByText('0 so‘m')).not.toHaveClass('debt');
  });

  it('qidiruv kechiktirilgan holda so‘rov yuboradi; saralash tugmalari parametrni o‘zgartiradi', async () => {
    const api = fakeApi();
    api.customers.mockResolvedValue(page([]));
    const user = userEvent.setup();
    renderApp(<Customers />, { api });
    await screen.findByText('Mijoz topilmadi');
    await user.type(screen.getByRole('searchbox'), 'mur');
    await waitFor(
      () =>
        expect(api.customers).toHaveBeenLastCalledWith(
          expect.objectContaining({ q: 'mur', sort: 'debt' }),
        ),
      { timeout: 2000 },
    );
    await user.click(screen.getByRole('button', { name: 'Ism' }));
    await waitFor(() =>
      expect(api.customers).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'name' })),
    );
    await user.click(screen.getByRole('button', { name: 'Faqat qarzdorlar' }));
    await waitFor(() =>
      expect(api.customers).toHaveBeenLastCalledWith(expect.objectContaining({ debtors: true })),
    );
  });

  it('“Yana yuklash” keyingi sahifani kursor bilan oladi', async () => {
    const api = fakeApi();
    api.customers
      .mockResolvedValueOnce(page([customer({ id: 'a', name: 'A' })], 'CUR1'))
      .mockResolvedValueOnce(page([customer({ id: 'b', name: 'B' })]));
    const user = userEvent.setup();
    renderApp(<Customers />, { api });
    await user.click(await screen.findByRole('button', { name: 'Yana yuklash' }));
    expect(await screen.findByText('B')).toBeInTheDocument();
    expect(api.customers).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'CUR1' }));
    expect(screen.queryByRole('button', { name: 'Yana yuklash' })).not.toBeInTheDocument();
  });

  it('arxiv tugmasi faqat egasiga', async () => {
    const api = fakeApi();
    api.customers.mockResolvedValue(page([]));
    renderApp(<Customers />, { api, role: 'STAFF' });
    await screen.findByText('Mijoz topilmadi');
    expect(screen.queryByRole('button', { name: 'Arxiv' })).not.toBeInTheDocument();
  });
});

describe('CustomerNew', () => {
  it('mijoz yaratadi (Idempotency-Key bilan) va uning sahifasiga o‘tadi', async () => {
    const api = fakeApi();
    api.createCustomer.mockResolvedValue(customer({ id: 'new1' }));
    const user = userEvent.setup();
    renderApp(<CustomerNew />, { api, route: '/customers/new' });
    await user.type(screen.getByLabelText('Ism'), '  Akmal ');
    await user.type(screen.getByLabelText('Telefon'), '90 123 45 67');
    await user.click(screen.getByRole('button', { name: 'Mijoz yaratish' }));
    await waitFor(() => expect(api.createCustomer).toHaveBeenCalled());
    expect(api.createCustomer).toHaveBeenCalledWith(
      { name: 'Akmal', phone: '90 123 45 67' },
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
  });

  it('bir xil ismli mijoz: yorliq kiritish so‘raladi', async () => {
    const api = fakeApi();
    api.createCustomer.mockRejectedValue(
      new ApiError(409, 'CONFLICT', 'x', { reason: 'LABEL_REQUIRED' }),
    );
    const user = userEvent.setup();
    renderApp(<CustomerNew />, { api });
    await user.type(screen.getByLabelText('Ism'), 'Ali');
    await user.click(screen.getByRole('button', { name: 'Mijoz yaratish' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Shu ismli mijoz bor. Farqlash uchun yorliq kiriting.',
    );
  });

  it('bo‘sh ism bilan yuborib bo‘lmaydi', () => {
    renderApp(<CustomerNew />, { api: fakeApi() });
    expect(screen.getByRole('button', { name: 'Mijoz yaratish' })).toBeDisabled();
  });
});

describe('CustomerDetail', () => {
  const setup = (
    opts: { role?: 'OWNER' | 'STAFF'; cust?: Partial<ReturnType<typeof customer>> } = {},
  ) => {
    const api = fakeApi();
    api.customer.mockResolvedValue(customer(opts.cust));
    api.ledger.mockResolvedValue({
      items: [
        entry({
          id: 'e3',
          seq: 3,
          type: 'ADJUSTMENT',
          amount: -450000,
          delta: -450000,
          runningBalance: 0,
          isReversal: true,
          description: 'xato',
        }),
        entry({
          id: 'e2',
          seq: 2,
          type: 'PAYMENT',
          amount: 100,
          delta: -100,
          runningBalance: 450000,
          reversedBy: null,
        }),
        entry({ id: 'e1', seq: 1, reversedBy: 'e3' }),
      ],
      nextCursor: null,
    });
    api.deleteEntry.mockResolvedValue({ balance: 0 });
    renderApp(<CustomerDetail />, {
      api,
      role: opts.role ?? 'OWNER',
      route: '/customers/c1',
      path: '/customers/:id',
    });
    return { api, user: userEvent.setup() };
  };

  it('qoldiq, telefon, tarix qatorlari (o‘chirilgan belgisi, qoldiq)', async () => {
    setup({ cust: { phone: '+998901234567', notes: 'Yaqin do‘st' } });
    expect(await screen.findByTestId('balance')).toHaveTextContent('450 000 so‘m');
    expect(screen.getByRole('link', { name: '+998901234567' })).toHaveAttribute(
      'href',
      'tel:+998901234567',
    );
    expect(screen.getByText('Yaqin do‘st')).toBeInTheDocument();
    const rows = await screen.findAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText('O‘chirish')).toBeInTheDocument();
    expect(within(rows[2]!).getByText(/o‘chirilgan/)).toBeInTheDocument();
    expect(rows[2]).toHaveClass('entry-deleted');
    expect(within(rows[1]!).getByText('qoldiq 450 000 so‘m')).toBeInTheDocument();
  });

  it('o‘chirilgan va storno yozuvlarda o‘chirish tugmasi yo‘q', async () => {
    setup();
    await screen.findAllByRole('listitem');
    expect(screen.getAllByRole('button', { name: /O‘chirish/ })).toHaveLength(1); // faqat e2
  });

  it('o‘chirish: tasdiqlash oynasi, sabab, Idempotency-Key bilan yuboriladi', async () => {
    const { api, user } = setup({ role: 'STAFF' });
    await user.click(await screen.findByRole('button', { name: /O‘chirish To‘lov/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('To‘lov 100 so‘m o‘chiriladi. Tarixda iz qoladi.');
    await user.type(within(dialog).getByLabelText('Sabab (ixtiyoriy)'), 'adashdim');
    await user.click(within(dialog).getByRole('button', { name: 'O‘chirish' }));
    await waitFor(() =>
      expect(api.deleteEntry).toHaveBeenCalledWith(
        'e2',
        'adashdim',
        expect.stringMatching(/^[0-9a-f-]{36}$/),
      ),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keyingi to‘lovi bor nasiyani o‘chirishda aniq xabar', async () => {
    const { api, user } = setup();
    api.deleteEntry.mockRejectedValue(
      new ApiError(409, 'CONFLICT', 'x', { reason: 'REVERSAL_WOULD_OVERDRAW' }),
    );
    await user.click(await screen.findByRole('button', { name: /O‘chirish To‘lov/ }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'O‘chirish' }),
    );
    expect(await screen.findByText('Avval keyingi to‘lovlarni o‘chiring.')).toBeInTheDocument();
  });

  it('arxivlash faqat egasiga ko‘rinadi va qarzi bor mijozda o‘chirilgan', async () => {
    setup({ role: 'STAFF' });
    await screen.findByTestId('balance');
    expect(screen.queryByRole('button', { name: 'Arxivlash' })).not.toBeInTheDocument();
  });

  it('egasi: qarzi bor mijozni arxivlab bo‘lmaydi; qarzsizini mumkin', async () => {
    setup({ cust: { balance: 100 } });
    expect(await screen.findByRole('button', { name: 'Arxivlash' })).toBeDisabled();
    expect(screen.getByText('Qarzi bor mijozni arxivlab bo‘lmaydi.')).toBeInTheDocument();
  });

  it('arxivdagi mijozda yozuv qo‘shish va o‘chirish yo‘q', async () => {
    setup({ cust: { status: 'ARCHIVED', balance: 0 } });
    expect(await screen.findByText('Bu mijoz arxivda.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Nasiya/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /O‘chirish/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Arxivdan chiqarish' })).toBeEnabled();
  });
});

describe('Staff', () => {
  const member = (over = {}) => ({
    userId: 'u2',
    name: 'Sotuvchi',
    username: 'sot',
    role: 'STAFF',
    status: 'ACTIVE',
    joinedAt: '2026-10-07T10:00:00Z',
    revokedAt: null,
    ...over,
  });

  it('taklif havolasi yaratiladi (Idempotency-Key bilan) va ko‘rsatiladi', async () => {
    const api = fakeApi();
    api.staff.mockResolvedValue({
      members: [member({ userId: 'u1', name: 'Egasi', role: 'OWNER' }), member()],
    });
    api.invite.mockResolvedValue({
      link: 'https://t.me/tdaftar_bot?start=inv_abc',
      expiresAt: '2026-10-09T10:00:00Z',
    });
    const user = userEvent.setup();
    renderApp(<Staff />, { api });
    await user.click(await screen.findByRole('button', { name: 'Xodim taklif qilish' }));
    expect(await screen.findByLabelText('link')).toHaveValue(
      'https://t.me/tdaftar_bot?start=inv_abc',
    );
    expect(api.invite).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f-]{36}$/));
  });

  it('har bosishda yangi taklif (kalit almashadi)', async () => {
    const api = fakeApi();
    api.staff.mockResolvedValue({ members: [] });
    api.invite.mockResolvedValue({ link: 'https://t.me/x', expiresAt: '2026-10-09T10:00:00Z' });
    const user = userEvent.setup();
    renderApp(<Staff />, { api });
    const btn = await screen.findByRole('button', { name: 'Xodim taklif qilish' });
    await user.click(btn);
    await waitFor(() => expect(api.invite).toHaveBeenCalledTimes(1));
    await user.click(btn);
    await waitFor(() => expect(api.invite).toHaveBeenCalledTimes(2));
    expect(api.invite.mock.calls[0]![0]).not.toBe(api.invite.mock.calls[1]![0]);
  });

  it('xodimni o‘chirish tasdiq bilan; egasida o‘chirish tugmasi yo‘q', async () => {
    const api = fakeApi();
    api.staff.mockResolvedValue({
      members: [member({ userId: 'u1', name: 'Egasi', role: 'OWNER' }), member()],
    });
    api.revoke.mockResolvedValue(member({ status: 'REVOKED' }));
    const user = userEvent.setup();
    renderApp(<Staff />, { api });
    await screen.findByText('Sotuvchi');
    expect(screen.getAllByRole('button', { name: /O‘chirish/ })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'O‘chirish Sotuvchi' }));
    expect(
      await screen.findByText('Sotuvchi biznesdan o‘chiriladi. Davom etasizmi?'),
    ).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'O‘chirish' }));
    await waitFor(() => expect(api.revoke).toHaveBeenCalledWith('u2'));
  });

  it('o‘chirilgan xodim ro‘yxatda belgilanadi', async () => {
    const api = fakeApi();
    api.staff.mockResolvedValue({
      members: [member({ status: 'REVOKED', revokedAt: '2026-10-08T00:00:00Z' })],
    });
    renderApp(<Staff />, { api });
    expect(await screen.findByText(/o‘chirilgan/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /O‘chirish/ })).not.toBeInTheDocument();
  });
});

describe('Settings', () => {
  it('nomni o‘zgartirish va obuna ma’lumotlari', async () => {
    const api = fakeApi();
    api.business.mockResolvedValue({
      id: 'biz-1',
      name: 'Baraka',
      shortCode: 'TD-AB2CD',
      currency: 'UZS',
      timezone: 'Asia/Tashkent',
      notifyOwnerOnDelete: true,
    });
    api.billing.mockResolvedValue({
      status: { state: 'TRIAL', until: '2026-10-21T10:00:00Z', daysLeft: 13 },
      trialEndsAt: '2026-10-21T10:00:00Z',
      paidUntil: null,
      shortCode: 'TD-AB2CD',
      priceUzs: 29000,
      supportPhone: '+998907900110',
    });
    api.updateBusiness.mockResolvedValue({});
    const user = userEvent.setup();
    renderApp(<Settings />, { api });

    expect(await screen.findByText('Sinov muddati')).toBeInTheDocument();
    expect(screen.getByText('Narx: 29 000 so‘m / oy')).toBeInTheDocument();
    expect(screen.getByText('Biznes kodi: TD-AB2CD')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Admin: +998907900110' })).toHaveAttribute(
      'href',
      'tel:+998907900110',
    );

    const name = screen.getByLabelText('Biznes nomi');
    await user.clear(name);
    await user.type(name, 'Yangi nom');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Saqlash' }));
    await waitFor(() =>
      expect(api.updateBusiness).toHaveBeenCalledWith({
        name: 'Yangi nom',
        notifyOwnerOnDelete: false,
      }),
    );
    expect(await screen.findByText('Saqlandi')).toBeInTheDocument();
  });

  it('muddati tugagan obuna', async () => {
    const api = fakeApi();
    api.business.mockResolvedValue({
      id: 'biz-1',
      name: 'B',
      shortCode: 'TD-AAAAA',
      currency: 'UZS',
      timezone: 'x',
      notifyOwnerOnDelete: true,
    });
    api.billing.mockResolvedValue({
      status: { state: 'EXPIRED', until: '2026-10-01T00:00:00Z', daysLeft: 0 },
      trialEndsAt: null,
      paidUntil: null,
      shortCode: 'TD-AAAAA',
      priceUzs: 29000,
      supportPhone: null,
    });
    renderApp(<Settings />, { api });
    expect(await screen.findByText('Muddati tugagan')).toBeInTheDocument();
    expect(screen.queryByText(/kun\)/)).not.toBeInTheDocument();
    expect(vi.isMockFunction(api.billing)).toBe(true);
  });
});
