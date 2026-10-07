import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { AmountInput } from './AmountInput';

function Harness({ initial = 0 }: { initial?: number }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <AmountInput value={v} onChange={setV} label="Summa" />
      <output data-testid="value">{v}</output>
    </>
  );
}

describe('AmountInput', () => {
  it('faqat raqamlar qabul qilinadi va mingliklar bo‘shliq bilan ko‘rsatiladi', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText('Summa');
    await user.type(input, '4a5b0,0.0 0');
    expect(input).toHaveValue('450 000');
    expect(screen.getByTestId('value')).toHaveTextContent('450000');
  });

  it('bo‘sh maydon = 0, placeholder ko‘rinadi', async () => {
    const user = userEvent.setup();
    render(<Harness initial={5000} />);
    const input = screen.getByLabelText('Summa');
    await user.clear(input);
    expect(screen.getByTestId('value')).toHaveTextContent('0');
    expect(input).toHaveValue('');
  });

  it('tezkor tugmalar summaga qo‘shadi', async () => {
    const user = userEvent.setup();
    render(<Harness initial={10_000} />);
    await user.click(screen.getByRole('button', { name: '+50 000' }));
    await user.click(screen.getByRole('button', { name: '+100 000' }));
    expect(screen.getByTestId('value')).toHaveTextContent('160000');
  });

  it('juda uzun kiritma 10 mlrd dan oshmaydi', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText('Summa'), '99999999999999');
    expect(Number(screen.getByTestId('value').textContent)).toBeLessThanOrEqual(99_999_999_999);
    await user.click(screen.getByRole('button', { name: '+500 000' }));
    expect(Number(screen.getByTestId('value').textContent)).toBeLessThanOrEqual(10_000_000_000);
  });
});
