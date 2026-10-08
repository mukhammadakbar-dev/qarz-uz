import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../lib/api';
import { customer, fakeApi, renderApp } from '../../test/helpers';
import { AddEntry } from './AddEntry';

const KEY = /^[0-9a-f-]{36}$/;
type User = ReturnType<typeof userEvent.setup>;

function setup(opts: { balance?: number; kind?: 'debt' | 'payment'; locale?: 'uz-Cyrl' } = {}) {
  const api = fakeApi();
  api['customer'].mockResolvedValue(customer({ balance: opts.balance ?? 450000 }));
  api['addEntry'].mockResolvedValue({ entry: { id: 'e9' }, balance: 0, replayed: false });
  const view = renderApp(<AddEntry />, {
    api,
    route: `/customers/c1/add/${opts.kind ?? 'payment'}`,
    path: '/customers/:id/add/:kind',
    ...(opts.locale ? { locale: opts.locale } : {}),
  });
  return { api, user: userEvent.setup(), ...view };
}

/** Raqam klaviaturasida bosish: "200000" → 2, 0, 0, 0, 0, 0. */
async function type(user: User, digits: string) {
  await screen.findByTestId('amount');
  for (const d of digits) await user.click(screen.getByRole('button', { name: d }));
}
const amount = () => screen.getByTestId('amount');
const saveButton = () => screen.getByRole('button', { name: /saqlash|Saqlash|saqlansin/ });

describe('AddEntry', () => {
  it('to‘lov: natija darhol ko‘rinadi; Saqlash Idempotency-Key bilan yuboradi va mijoz sahifasiga qaytadi', async () => {
    const { api, user } = setup();
    await type(user, '200000');
    expect(amount()).toHaveTextContent('200 000');
    expect(screen.getByText('Qoldiq: 450 000 → 250 000')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'To‘lovni saqlash · 200 000' }));
    await waitFor(() => expect(api['addEntry']).toHaveBeenCalledTimes(1));
    expect(api['addEntry']).toHaveBeenCalledWith(
      'c1',
      'payment',
      { amount: 200000 },
      expect.stringMatching(KEY),
    );
    expect(await screen.findByTestId('elsewhere')).toBeInTheDocument();
  });

  it('“000” tugmasi, boshidagi nollar va o‘chirish tugmasi', async () => {
    const { user } = setup({ kind: 'debt' });
    await type(user, '0');
    expect(amount()).toHaveTextContent('0');
    await type(user, '5');
    await user.click(screen.getByRole('button', { name: '000' }));
    expect(amount()).toHaveTextContent('5 000');
    await user.click(screen.getByRole('button', { name: 'Oxirgi raqamni o‘chirish' }));
    expect(amount()).toHaveTextContent('500');
  });

  it('kompyuter klaviaturasi: raqamlar va Backspace', async () => {
    const { user } = setup({ kind: 'debt' });
    await screen.findByTestId('amount');
    await user.keyboard('1234{Backspace}');
    expect(amount()).toHaveTextContent('123');
  });

  it('ortiqcha to‘lov: Saqlash bloklangan, sabab va eng ko‘pi ko‘rsatiladi', async () => {
    const { api, user } = setup({ balance: 100000 });
    await type(user, '150000');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Qarzdan ko‘p bo‘lmaydi · eng ko‘pi 100 000 so‘m',
    );
    expect(screen.getByRole('button', { name: 'Saqlash' })).toBeDisabled();
    expect(api['addEntry']).not.toHaveBeenCalled();
  });

  it('“Hammasi” tugmasi qoldiqni kiritadi (aniq to‘liq yopish)', async () => {
    const { user } = setup({ balance: 320000 });
    await user.click(await screen.findByRole('button', { name: 'Hammasi · 320 000' }));
    expect(amount()).toHaveTextContent('320 000');
    expect(screen.getByText('Qoldiq: 320 000 → 0')).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });

  it('qarzi yo‘q mijozga to‘lov yozib bo‘lmaydi', async () => {
    const { user } = setup({ balance: 0 });
    await type(user, '1000');
    expect(screen.getByRole('alert')).toHaveTextContent('Qarzi yo‘q — to‘lov yozib bo‘lmaydi');
    expect(screen.getByRole('button', { name: 'Saqlash' })).toBeDisabled();
  });

  it('turni almashtirish: qarz → to‘lov, natija qayta hisoblanadi', async () => {
    const { user } = setup({ kind: 'debt', balance: 100000 });
    await type(user, '50000');
    expect(screen.getByText('Qoldiq: 100 000 → 150 000')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'To‘lov oldim' }));
    expect(screen.getByRole('button', { name: 'To‘lov oldim' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('Qoldiq: 100 000 → 50 000')).toBeInTheDocument();
  });

  it('katta summa: birinchi bosish ogohlantiradi, ikkinchisi saqlaydi', async () => {
    const { api, user } = setup({ kind: 'debt', balance: 0 });
    await type(user, '60000000');
    await user.click(screen.getByRole('button', { name: 'Qarzni saqlash · 60 000 000' }));
    expect(api['addEntry']).not.toHaveBeenCalled();
    expect(screen.getByText('Katta summa. Tekshiring va yana bir bor bosing.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ha, 60 000 000 so‘m saqlansin' }));
    await waitFor(() => expect(api['addEntry']).toHaveBeenCalledTimes(1));
  });

  it('tarmoq xatosidan keyin qayta Saqlash BIR XIL kalit bilan; summa o‘zgarsa yangi kalit', async () => {
    const { api, user } = setup({ kind: 'debt', balance: 0 });
    api['addEntry'].mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await type(user, '5000');
    await user.click(saveButton());
    expect(await screen.findByText('Internet bilan aloqa yo‘q.')).toBeInTheDocument();
    await user.click(saveButton());
    await waitFor(() => expect(api['addEntry']).toHaveBeenCalledTimes(2));
    const [first, second] = api['addEntry'].mock.calls.map((c) => c[3] as string);
    expect(first).toBe(second);
  });

  it('niyat o‘zgarganda (summa tahrirlanganda) yangi kalit ishlatiladi', async () => {
    const { api, user } = setup({ kind: 'debt', balance: 0 });
    api['addEntry'].mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await type(user, '5000');
    await user.click(saveButton());
    await screen.findByText('Internet bilan aloqa yo‘q.');
    await type(user, '0');
    await user.click(saveButton());
    await waitFor(() => expect(api['addEntry']).toHaveBeenCalledTimes(2));
    const [a, b] = api['addEntry'].mock.calls.map((c) => c[3] as string);
    expect(a).not.toBe(b);
    expect(api['addEntry'].mock.calls[1]![2]).toMatchObject({ amount: 50000 });
  });

  it('server ortiqcha to‘lovni rad etsa xabar aniq summa bilan ko‘rsatiladi', async () => {
    const { api, user } = setup();
    api['addEntry'].mockRejectedValue(
      new ApiError(422, 'OVERPAYMENT', 'x', { maxPayable: 120000 }),
    );
    await type(user, '100000');
    await user.click(saveButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'To‘lov qarzdan ko‘p. Eng ko‘pi: 120 000 so‘m.',
    );
  });

  it('obuna tugagan (402) bo‘lsa tushunarli xabar', async () => {
    const { api, user } = setup({ kind: 'debt' });
    api['addEntry'].mockRejectedValue(new ApiError(402, 'SUBSCRIPTION_EXPIRED', 'x'));
    await type(user, '1000');
    await user.click(saveButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Obuna muddati tugagan: yozish bloklangan.',
    );
  });

  it('“Kecha” tanlansa dateOffsetDays=-1 yuboriladi; izoh kesib yuboriladi', async () => {
    const { api, user } = setup({ kind: 'debt', balance: 0 });
    await type(user, '1000');
    await user.click(screen.getByRole('button', { name: 'Sana' }));
    expect(screen.getByRole('button', { name: 'Sana' })).toHaveTextContent('Kecha');
    await user.type(screen.getByLabelText('Izoh (ixtiyoriy)'), '  un  ');
    await user.click(saveButton());
    await waitFor(() => expect(api['addEntry']).toHaveBeenCalled());
    expect(api['addEntry'].mock.calls[0]![2]).toEqual({
      amount: 1000,
      description: 'un',
      dateOffsetDays: -1,
    });
  });

  it('izoh yozilayotganda raqamlar summaga qo‘shilmaydi', async () => {
    const { user } = setup({ kind: 'debt' });
    await screen.findByTestId('amount');
    await user.type(screen.getByLabelText('Izoh (ixtiyoriy)'), '2 qop');
    expect(amount()).toHaveTextContent('0');
  });

  it('Kirill interfeysi', async () => {
    setup({ locale: 'uz-Cyrl' });
    expect(await screen.findByRole('button', { name: 'Тўлов олдим' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('Суммани киритинг')).toBeInTheDocument();
  });
});
