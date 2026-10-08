import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fakeApi, renderApp } from '../../test/helpers';
import { Layout } from './Layout';

const dashboard = (state: 'TRIAL' | 'ACTIVE' | 'EXPIRED', daysLeft = 10) => ({
  business: { id: 'biz-1', name: 'Baraka' },
  role: 'OWNER',
  summary: { totalDebt: 0, debtorsCount: 0, todayOperations: 0 },
  subscription: { state, until: '2026-12-01T00:00:00Z', daysLeft },
});

describe('Layout', () => {
  it('pastki menyu: Daftar va Biznes (egasi ham, xodim ham)', () => {
    for (const role of ['OWNER', 'STAFF'] as const) {
      const api = fakeApi();
      api['dashboard'].mockResolvedValue(dashboard('ACTIVE'));
      const view = renderApp(<Layout />, { api, role });
      const nav = screen.getByRole('navigation');
      expect(nav).toHaveTextContent('Daftar');
      expect(nav).toHaveTextContent('Biznes');
      view.unmount();
    }
  });

  it('ichki sahifada pastki menyu yashirinadi', () => {
    const api = fakeApi();
    api['dashboard'].mockResolvedValue(dashboard('ACTIVE'));
    renderApp(<Layout />, { api, route: '/customers/c1' });
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('obuna tugagan: “Obunani uzaytirish” admin chatini biznes kodi bilan tayyor xabarda ochadi', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const api = fakeApi();
    api['dashboard'].mockResolvedValue(dashboard('EXPIRED', 0));
    api['billing'].mockResolvedValue({ supportPhone: '+998907900110', shortCode: 'TD-AB2CD' });
    renderApp(<Layout />, { api });
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('Obuna muddati tugagan');
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Obunani uzaytirish' }));
    const url = new URL(open.mock.calls[0]![0] as string);
    expect(url.origin + url.pathname).toBe('https://t.me/+998907900110');
    expect(url.searchParams.get('text')).toBe(
      'Assalomu alaykum! Obuna muddatini uzaytirmoqchiman. ID: `TD-AB2CD`',
    );
    open.mockRestore();
  });

  it('xodim: banner bor, billing so‘ralmaydi (xodimga ochiq emas)', async () => {
    const api = fakeApi();
    api['dashboard'].mockResolvedValue(dashboard('EXPIRED', 0));
    renderApp(<Layout />, { api, role: 'STAFF' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Obuna muddati tugagan');
    expect(api['billing']).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Obunani uzaytirish' })).not.toBeInTheDocument();
  });

  it('sinov muddati tugashiga 3 kun qolganda eslatma; undan ko‘pida yo‘q', async () => {
    const api = fakeApi();
    api['dashboard'].mockResolvedValue(dashboard('TRIAL', 2));
    const first = renderApp(<Layout />, { api });
    expect(await screen.findByText('Sinov muddati: 2 kun qoldi')).toBeInTheDocument();
    first.unmount();

    const api2 = fakeApi();
    api2['dashboard']!.mockResolvedValue(dashboard('TRIAL', 10));
    renderApp(<Layout />, { api: api2 });
    await waitFor(() => expect(api2['dashboard']).toHaveBeenCalled());
    expect(screen.queryByText(/Sinov muddati/)).not.toBeInTheDocument();
  });
});
