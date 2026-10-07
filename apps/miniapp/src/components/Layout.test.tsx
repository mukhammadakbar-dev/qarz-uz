import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fakeApi, renderApp } from '../../test/helpers';
import { Layout } from './Layout';

const dashboard = (state: 'TRIAL' | 'ACTIVE' | 'EXPIRED', daysLeft = 10) => ({
  business: { id: 'biz-1', name: 'Baraka' },
  role: 'OWNER',
  summary: { totalDebt: 0, debtorsCount: 0, todayOperations: 0 },
  subscription: { state, until: '2026-12-01T00:00:00Z', daysLeft },
});

describe('Layout', () => {
  it('egasi hamma bo‘limlarni ko‘radi', async () => {
    const api = fakeApi();
    api['dashboard'].mockResolvedValue(dashboard('ACTIVE'));
    renderApp(<Layout />, { api, role: 'OWNER' });
    const nav = screen.getByRole('navigation');
    for (const name of ['Bosh sahifa', 'Mijozlar', 'Xodimlar', 'Sozlamalar'])
      expect(nav).toHaveTextContent(name);
  });

  it('xodim “Xodimlar” va “Sozlamalar” bo‘limlarini ko‘rmaydi', () => {
    const api = fakeApi();
    api['dashboard'].mockResolvedValue(dashboard('ACTIVE'));
    renderApp(<Layout />, { api, role: 'STAFF' });
    const nav = screen.getByRole('navigation');
    expect(nav).toHaveTextContent('Mijozlar');
    expect(nav).not.toHaveTextContent('Xodimlar');
    expect(nav).not.toHaveTextContent('Sozlamalar');
    expect(screen.getByText('Xodim', { selector: '.role' })).toBeInTheDocument();
  });

  it('obuna tugagan: banner va to‘lov raqami', async () => {
    const api = fakeApi();
    api['dashboard'].mockResolvedValue(dashboard('EXPIRED', 0));
    api['billing'].mockResolvedValue({ supportPhone: '+998907900110' });
    renderApp(<Layout />, { api });
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('Obuna muddati tugagan');
    await waitFor(() => expect(banner).toHaveTextContent('+998907900110'));
  });

  it('xodimga billing ochiq emas: banner raqamsiz ham ishlaydi', async () => {
    const api = fakeApi();
    api['dashboard'].mockResolvedValue(dashboard('EXPIRED', 0));
    api['billing'].mockRejectedValue(new Error('403'));
    renderApp(<Layout />, { api, role: 'STAFF' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Obuna muddati tugagan');
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
