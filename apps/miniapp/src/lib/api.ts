import type {
  AdminBusiness,
  AdminBusinessDetail,
  AdminFilter,
  AdminStats,
  Billing,
  Broadcast,
  BusinessSettings,
  Customer,
  CustomerPage,
  Dashboard,
  HistoryPage,
  Locale,
  Me,
  PostResult,
  Preview,
  SegmentState,
  SortKey,
  StaffMember,
} from './types';

/**
 * API klienti. Sessiya tokeni FAQAT xotirada (localStorage emas). 401 bo'lsa initData bilan qayta autentifikatsiya
 * qilinadi va so'rov bir marta takrorlanadi. Yozuv yaratuvchi so'rovlar chaqiruvchi bergan Idempotency-Key bilan ketadi.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
  get reason(): string | undefined {
    return typeof this.details['reason'] === 'string' ? this.details['reason'] : undefined;
  }
}

export interface ApiOptions {
  readonly getInitData: () => string;
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
}

interface RequestOptions {
  readonly query?: Record<string, string | number | boolean | undefined>;
  readonly body?: unknown;
  readonly key?: string;
}

export class ApiClient {
  private token: string | null = null;
  private authenticating: Promise<void> | null = null;
  businessId: string | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly options: ApiOptions) {
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.baseUrl = options.baseUrl ?? '';
  }

  private async send(
    method: string,
    path: string,
    opts: RequestOptions,
    withAuth: boolean,
  ): Promise<Response> {
    const url = new URL(
      `${this.baseUrl}${path}`,
      globalThis.location?.origin ?? 'http://localhost',
    );
    for (const [k, v] of Object.entries(opts.query ?? {}))
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (withAuth && this.token) headers['authorization'] = `Bearer ${this.token}`;
    if (withAuth && this.businessId) headers['x-business-id'] = this.businessId;
    if (opts.key) headers['idempotency-key'] = opts.key;
    return this.fetchImpl(this.baseUrl ? url.toString() : `${url.pathname}${url.search}`, {
      method,
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
  }

  private async toError(res: Response): Promise<ApiError> {
    let body: { code?: string; message?: string; details?: Record<string, unknown> } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      /* tana yo'q */
    }
    return new ApiError(
      res.status,
      body.code ?? 'ERROR',
      body.message ?? `HTTP ${res.status}`,
      body.details ?? {},
    );
  }

  /** initData bilan kirish; parallel chaqiruvlar bitta so'rovga birlashadi. */
  async authenticate(): Promise<void> {
    this.authenticating ??= (async () => {
      try {
        const res = await this.send(
          'POST',
          '/api/auth/telegram',
          { body: { initData: this.options.getInitData() } },
          false,
        );
        if (!res.ok) throw await this.toError(res);
        this.token = ((await res.json()) as { token: string }).token;
      } finally {
        this.authenticating = null;
      }
    })();
    return this.authenticating;
  }

  async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    if (!this.token) await this.authenticate();
    let res = await this.send(method, path, opts, true);
    if (res.status === 401) {
      // Sessiya muddati tugagan: bir marta qayta kirib, takrorlaymiz
      this.token = null;
      await this.authenticate();
      res = await this.send(method, path, opts, true);
    }
    if (!res.ok) throw await this.toError(res);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  // ───────── Endpointlar ─────────
  me = () => this.request<Me>('GET', '/api/me');
  setLocale = (locale: Locale) =>
    this.request<{ user: Me['user'] }>('PATCH', '/api/me', { body: { locale } });
  switchBusiness = (businessId: string) =>
    this.request<{ activeBusinessId: string }>('POST', '/api/businesses/active', {
      body: { businessId },
    });
  dashboard = () => this.request<Dashboard>('GET', '/api/dashboard');

  customers = (q: {
    q?: string;
    sort?: SortKey;
    cursor?: string;
    limit?: number;
    debtors?: boolean;
    status?: 'ACTIVE' | 'ARCHIVED';
  }) => this.request<CustomerPage>('GET', '/api/customers', { query: { ...q } });
  customer = (id: string) => this.request<Customer>('GET', `/api/customers/${id}`);
  createCustomer = (
    body: { name: string; label?: string; phone?: string; notes?: string },
    key: string,
  ) => this.request<Customer>('POST', '/api/customers', { body, key });
  updateCustomer = (
    id: string,
    body: Partial<{
      name: string;
      label: string | null;
      phone: string | null;
      notes: string | null;
    }>,
  ) => this.request<Customer>('PATCH', `/api/customers/${id}`, { body });
  archive = (id: string) => this.request<Customer>('POST', `/api/customers/${id}/archive`);
  unarchive = (id: string) => this.request<Customer>('POST', `/api/customers/${id}/unarchive`);

  ledger = (id: string, q: { cursor?: string; limit?: number } = {}) =>
    this.request<HistoryPage>('GET', `/api/customers/${id}/ledger`, { query: { ...q } });
  preview = (id: string, type: 'debt' | 'payment', amount: number) =>
    this.request<Preview>('GET', `/api/customers/${id}/preview`, { query: { type, amount } });
  addEntry = (
    id: string,
    kind: 'debt' | 'payment',
    body: { amount: number; description?: string; dateOffsetDays?: number },
    key: string,
  ) =>
    this.request<PostResult>(
      'POST',
      `/api/customers/${id}/${kind === 'debt' ? 'debts' : 'payments'}`,
      { body, key },
    );
  deleteEntry = (entryId: string, reason: string | undefined, key: string) =>
    this.request<{ balance: number }>('POST', `/api/entries/${entryId}/delete`, {
      body: reason ? { reason } : {},
      key,
    });

  staff = () => this.request<{ members: StaffMember[] }>('GET', '/api/staff');
  invite = (key: string) =>
    this.request<{ link: string; expiresAt: string }>('POST', '/api/staff/invites', { key });
  revoke = (userId: string) => this.request<StaffMember>('POST', `/api/staff/${userId}/revoke`);

  business = () => this.request<BusinessSettings>('GET', '/api/business');
  updateBusiness = (body: { name?: string; notifyOwnerOnDelete?: boolean }) =>
    this.request<BusinessSettings>('PATCH', '/api/business', { body });
  billing = () => this.request<Billing>('GET', '/api/billing');

  // ───────── Superadmin ─────────
  adminStats = () => this.request<AdminStats>('GET', '/api/admin/stats');
  adminBusinesses = (q: { q?: string; filter?: AdminFilter; cursor?: string; limit?: number }) =>
    this.request<{ items: AdminBusiness[]; nextCursor: string | null }>(
      'GET',
      '/api/admin/businesses',
      { query: { ...q } },
    );
  adminBusiness = (id: string) =>
    this.request<AdminBusinessDetail>('GET', `/api/admin/businesses/${id}`);
  adminCustomers = (id: string, q: { q?: string; cursor?: string; limit?: number }) =>
    this.request<CustomerPage>('GET', `/api/admin/businesses/${id}/customers`, {
      query: { ...q },
    });
  adminCustomer = (id: string, customerId: string) =>
    this.request<Customer>('GET', `/api/admin/businesses/${id}/customers/${customerId}`);
  adminLedger = (id: string, customerId: string, q: { cursor?: string; limit?: number } = {}) =>
    this.request<HistoryPage>('GET', `/api/admin/businesses/${id}/customers/${customerId}/ledger`, {
      query: { ...q },
    });
  adminExtend = (
    id: string,
    body: { months: number; amount?: number; note?: string },
    key: string,
  ) =>
    this.request<{ paidUntil: string; periodFrom: string }>(
      'POST',
      `/api/admin/businesses/${id}/extend`,
      { body, key },
    );
  adminSuspend = (id: string, reason?: string) =>
    this.request<{ suspendedAt: string | null }>('POST', `/api/admin/businesses/${id}/suspend`, {
      body: reason ? { reason } : {},
    });
  adminUnsuspend = (id: string) =>
    this.request<{ suspendedAt: string | null }>('POST', `/api/admin/businesses/${id}/unsuspend`, {
      body: {},
    });
  adminBroadcastPreview = (body: { segments: SegmentState[]; includeStaff: boolean }) =>
    this.request<{ recipients: number }>('POST', '/api/admin/broadcasts/preview', { body });
  adminBroadcast = (
    body: { text: string; segments: SegmentState[]; includeStaff: boolean },
    key: string,
  ) => this.request<{ id: string; total: number }>('POST', '/api/admin/broadcasts', { body, key });
  adminBroadcasts = () => this.request<{ items: Broadcast[] }>('GET', '/api/admin/broadcasts');
}
