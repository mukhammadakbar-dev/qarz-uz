import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import { dayLabel } from '../lib/format';
import { translate } from '../lib/i18n';
import { customer, entry, fakeApi, renderApp, type FakeApi } from '../../test/helpers';
import { Business } from './Business';
import { CustomerDetail } from './CustomerDetail';
import { CustomerNew } from './CustomerNew';
import { Home } from './Home';
import { PickCustomer } from './PickCustomer';

const KEY = /^[0-9a-f-]{36}$/;
const page = (items: ReturnType<typeof customer>[], nextCursor: string | null = null) => ({
  items,
  nextCursor,
});
const dashboard = (over: Record<string, unknown> = {}) => ({
  business: { id: 'biz-1', name: 'Baraka do‘koni' },
  role: 'OWNER',
  summary: { totalDebt: 12480000, debtorsCount: 23, todayOperations: 4 },
  subscription: { state: 'TRIAL', until: '2026-10-22T10:00:00Z', daysLeft: 9 },
  ...over,
});

describe('Home (Daftar)', () => {
  const setup = (role: 'OWNER' | 'STAFF' = 'OWNER') => {
    const api = fakeApi();
    api.dashboard.mockResolvedValue(dashboard());
    api.customers.mockResolvedValue(
      page([
        customer({
          id: 'a',
          name: 'Olga Petrovna',
          balance: 2400000,
          lastActivityAt: '2020-01-01T00:00:00Z',
        }),
        customer({
          id: 'b',
          name: 'Murod',
          label: 'aka',
          balance: 850000,
          lastActivityAt: new Date().toISOString(),
        }),
      ]),
    );
    renderApp(<Home />, { api, role, path: '/' });
    return { api, user: userEvent.setup() };
  };

  it('jami qarz, qarzdorlar soni, ro‘yxat va eski qarz belgisi', async () => {
    const { api } = setup();
    expect(await screen.findByTestId('total-debt')).toHaveAccessibleName('12 480 000 so‘m');
    expect(screen.getByText('23 qarzdor · bugun 4 ta yozuv')).toBeInTheDocument();
    expect(screen.getByText('Baraka do‘koni')).toBeInTheDocument();
    const olga = await screen.findByRole('link', { name: /Olga Petrovna/ });
    expect(olga).toHaveAttribute('href', '/customers/a');
    expect(within(olga).getByText(/oy oldin/)).toHaveClass('debt'); // eski qarz
    expect(within(screen.getByRole('link', { name: /Murod/ })).getByText('bugun')).not.toHaveClass(
      'debt',
    );
    expect(api.customers).toHaveBeenCalledWith({ sort: 'debt', debtors: true, limit: 30 });
  });

  it('qidiruv qarzsiz mijozlarni ham topadi; topilmasa shu ism bilan qo‘shish taklif qilinadi', async () => {
    const { api, user } = setup();
    await screen.findByRole('link', { name: /Murod/ });
    api.customers.mockResolvedValue(page([]));
    await user.type(screen.getByRole('searchbox'), 'Aziz');
    await waitFor(
      () => expect(api.customers).toHaveBeenLastCalledWith({ q: 'Aziz', sort: 'debt', limit: 30 }),
      { timeout: 2000 },
    );
    await user.click(await screen.findByRole('button', { name: '«Aziz» ni qo‘shish' }));
    expect(await screen.findByTestId('elsewhere')).toBeInTheDocument();
  });

  it('“Hammasi” oxirgi faollik bo‘yicha; xodimda “Arxiv” yo‘q', async () => {
    const { api, user } = setup('STAFF');
    await screen.findByRole('link', { name: /Murod/ });
    expect(screen.queryByRole('button', { name: 'Arxiv' })).not.toBeInTheDocument();
    expect(screen.getByText('Xodim')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hammasi' }));
    await waitFor(() =>
      expect(api.customers).toHaveBeenLastCalledWith({ sort: 'recent', limit: 30 }),
    );
  });

  it('“Yozuv” tugmasi mijoz tanlashga olib boradi', async () => {
    setup();
    expect(await screen.findByRole('link', { name: 'Yangi yozuv' })).toHaveAttribute(
      'href',
      '/pick/debt',
    );
  });

  it('“Yana yuklash” keyingi sahifani kursor bilan oladi', async () => {
    const api = fakeApi();
    api.dashboard.mockResolvedValue(dashboard());
    api.customers
      .mockResolvedValueOnce(page([customer({ id: 'a', name: 'A' })], 'CUR1'))
      .mockResolvedValueOnce(page([customer({ id: 'b', name: 'B' })]));
    const user = userEvent.setup();
    renderApp(<Home />, { api });
    await user.click(await screen.findByRole('button', { name: 'Yana yuklash' }));
    expect(await screen.findByRole('link', { name: /^B/ })).toBeInTheDocument();
    expect(api.customers).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'CUR1' }));
  });

  it('xato bo‘lsa qayta urinish tugmasi', async () => {
    const api = fakeApi();
    api.dashboard
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(dashboard());
    api.customers.mockResolvedValue(page([]));
    const user = userEvent.setup();
    renderApp(<Home />, { api });
    expect(await screen.findByRole('alert')).toHaveTextContent('Internet bilan aloqa yo‘q.');
    await user.click(screen.getByRole('button', { name: 'Qayta urinish' }));
    expect(await screen.findByTestId('total-debt')).toBeInTheDocument();
  });
});

describe('PickCustomer', () => {
  it('nasiya: oxirgi faol mijozlar, tanlansa yozuv ekraniga; yangi mijoz tugmasi', async () => {
    const api = fakeApi();
    api.customers.mockResolvedValue(page([customer({ id: 'a', name: 'Ali', balance: 0 })]));
    renderApp(<PickCustomer />, { api, route: '/pick/debt', path: '/pick/:kind' });
    expect(await screen.findByRole('heading', { name: 'Kimga nasiya?' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /Ali/ })).toHaveAttribute(
      'href',
      '/customers/a/add/debt',
    );
    expect(screen.getByRole('button', { name: 'Yangi mijoz' })).toBeInTheDocument();
    expect(api.customers).toHaveBeenCalledWith({ sort: 'recent', limit: 30 });
  });

  it('to‘lov: faqat qarzdorlar, yangi mijoz tugmasi yo‘q', async () => {
    const api = fakeApi();
    api.customers.mockResolvedValue(page([]));
    renderApp(<PickCustomer />, { api, route: '/pick/payment', path: '/pick/:kind' });
    expect(await screen.findByText('Qarzi bor mijoz yo‘q')).toBeInTheDocument();
    expect(api.customers).toHaveBeenCalledWith({ sort: 'recent', debtors: true, limit: 30 });
    expect(screen.queryByRole('button', { name: 'Yangi mijoz' })).not.toBeInTheDocument();
  });
});

describe('CustomerNew', () => {
  it('mijoz yaratadi (Idempotency-Key bilan); ism qidiruvdan oldindan to‘ldiriladi', async () => {
    const api = fakeApi();
    api.createCustomer.mockResolvedValue(customer({ id: 'new1' }));
    const user = userEvent.setup();
    renderApp(<CustomerNew />, {
      api,
      route: '/customers/new?name=Akmal&then=debt',
      path: '/customers/new',
    });
    expect(screen.getByLabelText('Ism')).toHaveValue('Akmal');
    await user.type(screen.getByLabelText('Telefon'), '90 123 45 67');
    await user.click(screen.getByRole('button', { name: 'Mijoz yaratish' }));
    await waitFor(() =>
      expect(api.createCustomer).toHaveBeenCalledWith(
        { name: 'Akmal', phone: '90 123 45 67' },
        expect.stringMatching(KEY),
      ),
    );
    expect(await screen.findByTestId('elsewhere')).toBeInTheDocument();
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
  const ledger = {
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
        description: 'naqd',
      }),
      entry({ id: 'e1', seq: 1, reversedBy: 'e3' }),
    ],
    nextCursor: null,
  };
  const setup = (
    opts: {
      role?: 'OWNER' | 'STAFF';
      cust?: Partial<ReturnType<typeof customer>>;
      state?: unknown;
      api?: FakeApi;
    } = {},
  ) => {
    const api = opts.api ?? fakeApi();
    api.customer.mockResolvedValue(customer(opts.cust));
    api.ledger.mockResolvedValue(ledger);
    api.deleteEntry.mockResolvedValue({ balance: 0 });
    renderApp(<CustomerDetail />, {
      api,
      role: opts.role ?? 'OWNER',
      route: '/customers/c1',
      path: '/customers/:id',
      state: opts.state,
    });
    return { api, user: userEvent.setup() };
  };
  const t = (k: 'day.today' | 'day.yesterday') => translate('uz-Latn', k);

  it('qoldiq, telefon, izoh, kun sarlavhasi va tarix qatorlari', async () => {
    setup({ cust: { phone: '+998901234567', notes: 'Yaqin do‘st' } });
    expect(await screen.findByTestId('balance')).toHaveAccessibleName('450 000 so‘m');
    expect(screen.getByRole('link', { name: '+998901234567' })).toHaveAttribute(
      'href',
      'tel:+998901234567',
    );
    expect(screen.getByText('Yaqin do‘st')).toBeInTheDocument();
    const rows = await screen.findAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(
      screen.getByRole('heading', { name: dayLabel('2026-10-07T10:00:00Z', 'uz-Latn', t) }),
    ).toBeInTheDocument();
    expect(within(rows[0]!).getByText('O‘chirish')).toBeInTheDocument();
    expect(rows[2]).toHaveClass('entry-deleted');
    expect(within(rows[2]!).getByText(/o‘chirilgan/)).toBeInTheDocument();
    expect(within(rows[1]!).getByText('qoldiq 450 000')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('−100')).toHaveClass('pay');
  });

  it('o‘chirish: tafsilot → O‘chirish → sabab → Ha, o‘chirish (Idempotency-Key bilan)', async () => {
    const { api, user } = setup({ role: 'STAFF' });
    const rows = await screen.findAllByRole('listitem');
    await user.click(within(rows[1]!).getByRole('button'));
    const dialog = await screen.findByRole('dialog', { name: 'Yozuv tafsiloti' });
    expect(within(dialog).getByText('450 100 → 450 000')).toBeInTheDocument();
    expect(within(dialog).getByText('naqd')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /O‘chirish To‘lov/ }));
    expect(dialog).toHaveTextContent('Qoldiq 450 100 so‘mga qaytadi.');
    await user.type(within(dialog).getByLabelText('Sabab (ixtiyoriy)'), 'adashdim');
    await user.click(within(dialog).getByRole('button', { name: 'Ha, o‘chirish' }));
    await waitFor(() =>
      expect(api.deleteEntry).toHaveBeenCalledWith('e2', 'adashdim', expect.stringMatching(KEY)),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('O‘chirildi')).toBeInTheDocument();
  });

  it('“Yo‘q, qolsin” o‘chirmaydi; o‘chirilgan va storno yozuvlarda o‘chirish yo‘q', async () => {
    const { api, user } = setup();
    const rows = await screen.findAllByRole('listitem');
    await user.click(within(rows[1]!).getByRole('button'));
    await user.click(screen.getByRole('button', { name: /O‘chirish To‘lov/ }));
    await user.click(screen.getByRole('button', { name: 'Yo‘q, qolsin' }));
    expect(api.deleteEntry).not.toHaveBeenCalled();
    await user.click(screen.getAllByRole('button', { name: 'Yopish' })[0]!);

    for (const i of [0, 2]) {
      await user.click(within(rows[i]!).getByRole('button'));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).queryByRole('button', { name: /O‘chirish/ })).not.toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Yopish' }));
    }
  });

  it('keyingi to‘lovi bor nasiyani o‘chirishda aniq xabar', async () => {
    const { api, user } = setup();
    api.deleteEntry.mockRejectedValue(
      new ApiError(409, 'CONFLICT', 'x', { reason: 'REVERSAL_WOULD_OVERDRAW' }),
    );
    const rows = await screen.findAllByRole('listitem');
    await user.click(within(rows[1]!).getByRole('button'));
    await user.click(screen.getByRole('button', { name: /O‘chirish To‘lov/ }));
    await user.click(screen.getByRole('button', { name: 'Ha, o‘chirish' }));
    expect(await screen.findByText('Avval keyingi to‘lovlarni o‘chiring.')).toBeInTheDocument();
  });

  it('saqlangandan keyin “Qaytarish”: yozuv o‘chiriladi va “Bekor qilindi”', async () => {
    const { api, user } = setup({
      state: { saved: { entryId: 'e9', type: 'payment', amount: 250000 } },
    });
    const toast = (await screen.findByText('To‘lov saqlandi · 250 000')).closest('.toast');
    expect(toast).toHaveAttribute('role', 'status');
    await user.click(within(toast as HTMLElement).getByRole('button', { name: 'Qaytarish' }));
    await waitFor(() =>
      expect(api.deleteEntry).toHaveBeenCalledWith('e9', undefined, expect.stringMatching(KEY)),
    );
    expect(await screen.findByText('Bekor qilindi')).toBeInTheDocument();
  });

  it('xodimda mijoz amallari menyusi yo‘q', async () => {
    setup({ role: 'STAFF' });
    await screen.findByTestId('balance');
    expect(screen.queryByRole('button', { name: 'Mijoz amallari' })).not.toBeInTheDocument();
  });

  it('egasi: qarzi bor mijozni arxivlab bo‘lmaydi', async () => {
    const { user } = setup({ cust: { balance: 100 } });
    await user.click(await screen.findByRole('button', { name: 'Mijoz amallari' }));
    expect(screen.getByRole('button', { name: 'Arxivlash' })).toBeDisabled();
    expect(screen.getByText('Qarzi bor mijozni arxivlab bo‘lmaydi.')).toBeInTheDocument();
  });

  it('arxivdagi mijozda yozuv qo‘shish va o‘chirish yo‘q; arxivdan chiqarish mumkin', async () => {
    const { api, user } = setup({ cust: { status: 'ARCHIVED', balance: 0 } });
    api.unarchive.mockResolvedValue(customer());
    expect(await screen.findByText('Bu mijoz arxivda.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Qarz berdim/ })).not.toBeInTheDocument();
    const rows = await screen.findAllByRole('listitem');
    await user.click(within(rows[1]!).getByRole('button'));
    expect(screen.queryByRole('button', { name: /O‘chirish To‘lov/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yopish' }));
    await user.click(screen.getByRole('button', { name: 'Mijoz amallari' }));
    await user.click(screen.getByRole('button', { name: 'Arxivdan chiqarish' }));
    await waitFor(() => expect(api.unarchive).toHaveBeenCalledWith('c1'));
  });
});

describe('Business', () => {
  const member = (over = {}) => ({
    userId: 'u2',
    name: 'Dilnoza',
    username: null,
    role: 'STAFF',
    status: 'ACTIVE',
    joinedAt: '2026-10-05T10:00:00Z',
    revokedAt: null,
    ...over,
  });
  const setup = (opts: { role?: 'OWNER' | 'STAFF'; expired?: boolean } = {}) => {
    const api = fakeApi();
    const status = opts.expired
      ? { state: 'EXPIRED', until: '2026-10-01T00:00:00Z', daysLeft: 0 }
      : { state: 'TRIAL', until: '2026-10-22T10:00:00Z', daysLeft: 9 };
    api.dashboard.mockResolvedValue(dashboard({ subscription: status }));
    api.billing.mockResolvedValue({
      status,
      trialEndsAt: '2026-10-22T10:00:00Z',
      paidUntil: null,
      shortCode: 'TD-AB2CD',
      priceUzs: 29000,
      supportPhone: '+998907900110',
    });
    api.business.mockResolvedValue({
      id: 'biz-1',
      name: 'Baraka do‘koni',
      shortCode: 'TD-AB2CD',
      currency: 'UZS',
      timezone: 'Asia/Tashkent',
      notifyOwnerOnDelete: true,
    });
    api.staff.mockResolvedValue({
      members: [member({ userId: 'u1', name: 'Akbar', role: 'OWNER' }), member()],
    });
    api.updateBusiness.mockResolvedValue({});
    renderApp(<Business />, { api, role: opts.role ?? 'OWNER' });
    return { api, user: userEvent.setup() };
  };

  it('egasi: obuna holati, narx, biznes kodi; uzaytirish tugmasi tayyor xabar bilan', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { user } = setup();
    const card = await screen.findByRole('region', { name: 'Obuna' });
    expect(within(card).getByText('Sinov davri')).toBeInTheDocument();
    expect(within(card).getByText('9 kun')).toBeInTheDocument();
    expect(within(card).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '9');
    expect(await within(card).findByText(/Oyiga 29 000 so‘m/)).toBeInTheDocument();
    expect(within(card).getByText('Biznes kodi: TD-AB2CD')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Obunani uzaytirish' }));
    expect(new URL(open.mock.calls[0]![0] as string).searchParams.get('text')).toBe(
      'Assalomu alaykum! Obuna muddatini uzaytirmoqchiman. ID: `TD-AB2CD`',
    );
    open.mockRestore();
  });

  it('muddati tugagan obuna', async () => {
    setup({ expired: true });
    const card = await screen.findByRole('region', { name: 'Obuna' });
    expect(within(card).getByText('Muddati tugagan')).toBeInTheDocument();
    expect(within(card).queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('nomni o‘zgartirish', async () => {
    const { api, user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Nomini o‘zgartirish' }));
    const input = screen.getByLabelText('Biznes nomi');
    await user.clear(input);
    await user.type(input, 'Yangi nom');
    await user.click(screen.getByRole('button', { name: 'Saqlash' }));
    await waitFor(() => expect(api.updateBusiness).toHaveBeenCalledWith({ name: 'Yangi nom' }));
  });

  it('xodimlar: o‘zi belgilanadi, chiqarish tasdiq bilan; egasini chiqarib bo‘lmaydi', async () => {
    const { api, user } = setup();
    api.revoke.mockResolvedValue(member({ status: 'REVOKED' }));
    expect(await screen.findByText('Akbar (siz)')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Chiqarish/ })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Chiqarish Dilnoza' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Dilnoza biznesdan chiqariladi. Davom etasizmi?');
    await user.click(within(dialog).getByRole('button', { name: 'Chiqarish' }));
    await waitFor(() => expect(api.revoke).toHaveBeenCalledWith('u2'));
  });

  it('taklif havolasi: har bosishda yangi kalit', async () => {
    const { api, user } = setup();
    api.invite.mockResolvedValue({
      link: 'https://t.me/kissauzbot?start=inv_abc',
      expiresAt: '2026-10-09T10:00:00Z',
    });
    const btn = await screen.findByRole('button', { name: 'Xodim taklif qilish' });
    await user.click(btn);
    expect(await screen.findByLabelText('Taklif havolasi')).toHaveValue(
      'https://t.me/kissauzbot?start=inv_abc',
    );
    await user.click(btn);
    await waitFor(() => expect(api.invite).toHaveBeenCalledTimes(2));
    expect(api.invite.mock.calls[0]![0]).toMatch(KEY);
    expect(api.invite.mock.calls[0]![0]).not.toBe(api.invite.mock.calls[1]![0]);
  });

  it('o‘chirish haqida xabar sozlamasi darhol saqlanadi', async () => {
    const { api, user } = setup();
    const toggle = await screen.findByRole('switch', {
      name: 'Xodim yozuvni o‘chirsa menga xabar kelsin',
    });
    await waitFor(() => expect(toggle).toBeChecked());
    await user.click(toggle);
    await waitFor(() =>
      expect(api.updateBusiness).toHaveBeenCalledWith({ notifyOwnerOnDelete: false }),
    );
  });

  it('alifbo almashtiriladi', async () => {
    const { api, user } = setup();
    api.setLocale.mockResolvedValue({ user: {} });
    await user.click(await screen.findByRole('button', { name: 'Кирилл' }));
    await waitFor(() => expect(api.setLocale).toHaveBeenCalledWith('uz-Cyrl'));
  });

  it('xodim: obuna holatini ko‘radi, xodimlar va narx bo‘limi yo‘q', async () => {
    const { api } = setup({ role: 'STAFF' });
    const card = await screen.findByRole('region', { name: 'Obuna' });
    expect(within(card).getByText('9 kun')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Xodimlar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nomini o‘zgartirish' })).not.toBeInTheDocument();
    expect(api.billing).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Lotin' })).toHaveAttribute('aria-pressed', 'true');
  });
});
