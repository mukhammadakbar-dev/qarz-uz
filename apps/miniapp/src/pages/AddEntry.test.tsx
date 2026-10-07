import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../lib/api';
import { customer, fakeApi, renderApp } from '../../test/helpers';
import { AddEntry } from './AddEntry';

const KEY = /^[0-9a-f-]{36}$/;

function setup(opts: { balance?: number; kind?: 'debt' | 'payment' } = {}) {
  const kind = opts.kind ?? 'payment';
  const api = fakeApi();
  api['customer'].mockResolvedValue(customer({ balance: opts.balance ?? 450000 }));
  api['preview'].mockImplementation(async (_id: string, type: string, amount: number) => {
    const balance = opts.balance ?? 450000;
    return type === 'payment'
      ? {
          type,
          balance,
          allowed: amount <= balance,
          balanceAfter: amount <= balance ? balance - amount : null,
          maxPayable: balance,
        }
      : { type, balance, allowed: true, balanceAfter: balance + amount };
  });
  api['addEntry'].mockResolvedValue({ entry: {}, balance: 0, replayed: false });
  const view = renderApp(<AddEntry />, {
    api,
    route: `/customers/c1/add/${kind}`,
    path: '/customers/:id/add/:kind',
  });
  return { api, user: userEvent.setup(), ...view };
}
const typeAmount = async (user: ReturnType<typeof userEvent.setup>, v: string) =>
  user.type(await screen.findByLabelText('Summa (so‘m)'), v);

describe('AddEntry', () => {
  it('to‘lov: tasdiq oynasi qoldiqni ko‘rsatadi, Saqlash Idempotency-Key bilan yuboradi', async () => {
    const { api, user } = setup();
    await typeAmount(user, '200000');
    await user.click(screen.getByRole('button', { name: 'Davom etish' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('balance-after')).toHaveTextContent('250 000 so‘m');
    expect(api['preview']).toHaveBeenCalledWith('c1', 'payment', 200000);

    await user.click(within(dialog).getByRole('button', { name: 'Saqlash' }));
    await waitFor(() => expect(api['addEntry']).toHaveBeenCalledTimes(1));
    expect(api['addEntry']).toHaveBeenCalledWith(
      'c1',
      'payment',
      { amount: 200000 },
      expect.stringMatching(KEY),
    );
    await waitFor(() => expect(screen.getByTestId('elsewhere')).toBeInTheDocument()); // mijoz sahifasiga qaytdi
  });

  it('ortiqcha to‘lov: Davom etish bloklangan, sabab va eng ko‘pi ko‘rsatiladi', async () => {
    const { api, user } = setup({ balance: 100000 });
    await typeAmount(user, '150000');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'To‘lov qarzdan ko‘p bo‘lishi mumkin emas.',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Eng ko‘pi: 100 000 so‘m');
    expect(screen.getByRole('button', { name: 'Davom etish' })).toBeDisabled();
    expect(api['preview']).not.toHaveBeenCalled();
  });

  it('“Hammasi” tugmasi qoldiqni kiritadi (aniq to‘liq yopish)', async () => {
    const { user } = setup({ balance: 320000 });
    await user.click(await screen.findByRole('button', { name: 'Hammasi: 320 000 so‘m' }));
    expect(screen.getByLabelText('Summa (so‘m)')).toHaveValue('320 000');
    expect(screen.getByRole('button', { name: 'Davom etish' })).toBeEnabled();
  });

  it('qarzi yo‘q mijozga to‘lov yozib bo‘lmaydi', async () => {
    const { user } = setup({ balance: 0 });
    await typeAmount(user, '1000');
    expect(screen.getByText('Qarzi yo‘q mijozga to‘lov yozib bo‘lmaydi.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Davom etish' })).toBeDisabled();
  });

  it('nasiya: qoldiq oshadi, katta summada ogohlantirish chiqadi', async () => {
    const { user } = setup({ kind: 'debt', balance: 0 });
    await typeAmount(user, '60000000');
    await user.click(screen.getByRole('button', { name: 'Davom etish' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('balance-after')).toHaveTextContent('60 000 000 so‘m');
    expect(within(dialog).getByText('Katta summa. Diqqat bilan tekshiring.')).toBeInTheDocument();
  });

  it('tarmoq xatosidan keyin qayta Saqlash BIR XIL kalit bilan ketadi; summa o‘zgarsa yangi kalit', async () => {
    const { api, user } = setup({ kind: 'debt', balance: 0 });
    api['addEntry'].mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await typeAmount(user, '5000');
    await user.click(screen.getByRole('button', { name: 'Davom etish' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Saqlash' }),
    );
    expect(await screen.findByText('Internet bilan aloqa yo‘q.')).toBeInTheDocument();

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Saqlash' }));
    await waitFor(() => expect(api['addEntry']).toHaveBeenCalledTimes(2));
    const [first, second] = api['addEntry'].mock.calls.map((c) => c[3] as string);
    expect(first).toBe(second);
  });

  it('niyat o‘zgarganda (summa tahrirlanganda) yangi kalit ishlatiladi', async () => {
    const { api, user } = setup({ kind: 'debt', balance: 0 });
    api['addEntry'].mockRejectedValue(new TypeError('Failed to fetch'));
    await typeAmount(user, '5000');
    await user.click(screen.getByRole('button', { name: 'Davom etish' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Saqlash' }),
    );
    await screen.findByText('Internet bilan aloqa yo‘q.');
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Bekor qilish' }),
    );

    await user.type(screen.getByLabelText('Summa (so‘m)'), '0');
    await user.click(screen.getByRole('button', { name: 'Davom etish' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Saqlash' }),
    );
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
    await typeAmount(user, '100000');
    await user.click(screen.getByRole('button', { name: 'Davom etish' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Saqlash' }),
    );
    expect(
      await screen.findByText('To‘lov qarzdan ko‘p. Eng ko‘pi: 120 000 so‘m.'),
    ).toBeInTheDocument();
  });

  it('obuna tugagan (402) bo‘lsa tushunarli xabar', async () => {
    const { api, user } = setup({ kind: 'debt' });
    api['addEntry'].mockRejectedValue(new ApiError(402, 'SUBSCRIPTION_EXPIRED', 'x'));
    await typeAmount(user, '1000');
    await user.click(screen.getByRole('button', { name: 'Davom etish' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Saqlash' }),
    );
    expect(
      await screen.findByText('Obuna muddati tugagan: yozish bloklangan.'),
    ).toBeInTheDocument();
  });

  it('“Kecha” tanlansa dateOffsetDays=-1 yuboriladi; izoh kesib yuboriladi', async () => {
    const { api, user } = setup({ kind: 'debt', balance: 0 });
    await typeAmount(user, '1000');
    await user.click(screen.getByRole('button', { name: 'Kecha' }));
    await user.type(screen.getByLabelText('Izoh (ixtiyoriy)'), '  un  ');
    await user.click(screen.getByRole('button', { name: 'Davom etish' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Saqlash' }),
    );
    await waitFor(() => expect(api['addEntry']).toHaveBeenCalled());
    expect(api['addEntry'].mock.calls[0]![2]).toEqual({
      amount: 1000,
      description: 'un',
      dateOffsetDays: -1,
    });
  });

  it('Kirill interfeysi', async () => {
    const api = fakeApi();
    api['customer'].mockResolvedValue(customer({ name: 'Мурод' }));
    renderApp(<AddEntry />, {
      api,
      locale: 'uz-Cyrl',
      route: '/customers/c1/add/payment',
      path: '/customers/:id/add/:kind',
    });
    expect(await screen.findByRole('heading', { name: 'Тўлов қўшиш' })).toBeInTheDocument();
    expect(screen.getByLabelText('Сумма (сўм)')).toBeInTheDocument();
  });
});
