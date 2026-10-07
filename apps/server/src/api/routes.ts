import type {
  FastifyBaseLogger,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { Config } from '../config/index.js';
import { ValidationError } from '../errors/index.js';
import { createAuthenticate, createRequireBusiness } from '../http/auth.js';
import { notifyOwnerOfDeletion } from '../modules/assistant/notify.js';
import { loadBilling } from '../modules/billing/service.js';
import {
  archiveCustomer,
  createCustomer,
  getCustomer,
  searchCustomers,
  unarchiveCustomer,
  updateCustomer,
} from '../modules/customers/index.js';
import {
  deleteEntry,
  getBusinessSummary,
  getEntry,
  getHistory,
  postAdjustment,
  postDebt,
  postPayment,
  previewDebt,
  previewPayment,
} from '../modules/ledger/index.js';
import {
  createInvite,
  getBusinessSettings,
  listStaff,
  revokeMember,
  setActiveBusiness,
  updateBusinessSettings,
  type Permission,
} from '../modules/tenancy/index.js';
import type { Logger } from '../observability/logger.js';
import { runIdempotent } from './idempotency.js';

/**
 * Mini App REST API (TT §31–34). Har bir yo'l: Bearer sessiya → a'zolik (DB'dan, keshsiz) → RBAC → servis.
 * Klient yuborgan business_id / user_id / rol HISOBGA OLINMAYDI: `X-Business-Id` faqat selector.
 * Yozuv yaratuvchi POST'lar `Idempotency-Key` talab qiladi (ADR-0003).
 */

export interface ApiDeps {
  readonly config: Pick<Config, 'telegram' | 'session' | 'billing' | 'api'>;
  readonly pool: Pool;
  readonly logger: Logger;
  readonly botUsername: () => string;
  readonly send: (chatId: number, text: string) => Promise<unknown>;
}

type App<L extends FastifyBaseLogger> = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  L
>;

const int = z.number().int();
const customerBody = z.object({
  name: z.string().min(1).max(200),
  label: z.string().max(100).nullish(),
  phone: z.string().max(40).nullish(),
  notes: z.string().max(1000).nullish(),
});
const amountBody = z.object({
  amount: int,
  description: z.string().max(500).nullish(),
  dateOffsetDays: int.min(-365).max(0).optional(),
});
const adjustmentBody = z.object({ amount: int, description: z.string().min(1).max(500) });
const deleteBody = z.object({ reason: z.string().max(500).nullish() }).default({});
const listQuery = z.object({
  q: z.string().max(100).optional(),
  sort: z.enum(['debt', 'newest', 'name']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(400).optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  debtors: z.enum(['true', 'false']).optional(),
});
const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(200).optional(),
});
const previewQuery = z.object({ type: z.enum(['debt', 'payment']), amount: z.coerce.number() });
const activeBody = z.object({ businessId: z.string().uuid() });
const idParams = z.object({ id: z.string().max(64) });
const userParams = z.object({ userId: z.string().max(64) });

function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new ValidationError('So‘rov noto‘g‘ri', {
      details: { fields: r.error.issues.map((i) => i.path.join('.') || '(tana)') },
    });
  }
  return r.data;
}

/** `undefined` qiymatlarni olib tashlaydi (nullish → ixtiyoriy maydonlar uchun). */
const compact = <T extends Record<string, unknown>>(
  o: T,
): { [K in keyof T]: Exclude<T[K], undefined> } =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as never;

export function registerApi<L extends FastifyBaseLogger>(app: App<L>, deps: ApiDeps): void {
  const { pool } = deps;
  const requireBusiness = createRequireBusiness({ config: deps.config, pool });
  const authenticate = createAuthenticate({ config: deps.config, pool });
  const guard = (permission: Permission) => ({ preHandler: requireBusiness(permission) });

  /** Yozuv yaratuvchi so'rovni Idempotency-Key bilan bajaradi. */
  const idempotent = async (
    request: FastifyRequest,
    reply: FastifyReply,
    execute: (ledgerKey: string) => Promise<{ status: number; body: unknown }>,
  ) => {
    const out = await runIdempotent(pool, request, request.user!.id, execute);
    if (out.replayed) reply.header('idempotent-replayed', 'true');
    return reply.status(out.status).send(out.body);
  };

  // ───────── Biznes tanlash (faqat a'zo bo'lgan biznesga) ─────────
  app.post('/api/businesses/active', { preHandler: authenticate }, async (request) => {
    const { businessId } = parse(activeBody, request.body);
    const access = await setActiveBusiness(pool, request.user!.id, businessId);
    return { activeBusinessId: access.businessId, role: access.role };
  });

  // ───────── Dashboard (TT §31) ─────────
  app.get('/api/dashboard', guard('customer.view'), async (request) => {
    const access = request.access!;
    const [settings, summary, billing] = await Promise.all([
      getBusinessSettings(pool, access),
      getBusinessSummary(pool, access),
      loadBilling(pool, access),
    ]);
    return {
      business: { id: settings.id, name: settings.name },
      role: access.role,
      summary,
      subscription: billing.status,
    };
  });

  // ───────── Mijozlar (TT §32–33) ─────────
  app.get('/api/customers', guard('customer.view'), async (request) => {
    const q = parse(listQuery, request.query);
    return searchCustomers(
      pool,
      request.access!,
      compact({
        q: q.q,
        sort: q.sort,
        limit: q.limit,
        cursor: q.cursor,
        status: q.status,
        onlyDebtors: q.debtors === undefined ? undefined : q.debtors === 'true',
      }),
    );
  });

  app.post('/api/customers', guard('customer.create'), (request, reply) =>
    idempotent(request, reply, async () => {
      const body = parse(customerBody, request.body);
      const customer = await createCustomer(pool, request.access!, compact(body));
      return { status: 201, body: customer };
    }),
  );

  app.get('/api/customers/:id', guard('customer.view'), async (request) =>
    getCustomer(pool, request.access!, parse(idParams, request.params).id),
  );

  app.patch('/api/customers/:id', guard('customer.update'), async (request) =>
    updateCustomer(
      pool,
      request.access!,
      parse(idParams, request.params).id,
      compact(parse(customerBody.partial(), request.body)),
    ),
  );

  app.post('/api/customers/:id/archive', guard('customer.archive'), async (request) =>
    archiveCustomer(pool, request.access!, parse(idParams, request.params).id),
  );
  app.post('/api/customers/:id/unarchive', guard('customer.unarchive'), async (request) =>
    unarchiveCustomer(pool, request.access!, parse(idParams, request.params).id),
  );

  app.get('/api/customers/:id/ledger', guard('ledger.history.view'), async (request) => {
    const q = parse(historyQuery, request.query);
    return getHistory(pool, request.access!, parse(idParams, request.params).id, compact(q));
  });

  // Tasdiq oynasi uchun: yozmaydi
  app.get('/api/customers/:id/preview', guard('customer.view'), async (request) => {
    const { type, amount } = parse(previewQuery, request.query);
    const id = parse(idParams, request.params).id;
    const access = request.access!;
    if (type === 'payment') return { type, ...(await previewPayment(pool, access, id, amount)) };
    const preview = await previewDebt(pool, access, id, amount);
    return { type, ...preview, allowed: Number.isSafeInteger(amount) && amount >= 1 };
  });

  // ───────── Moliyaviy yozuvlar (faqat LedgerService orqali) ─────────
  const ledgerWrite = (kind: 'debt' | 'payment', permission: Permission) =>
    app.post(
      `/api/customers/:id/${kind === 'debt' ? 'debts' : 'payments'}`,
      guard(permission),
      (request, reply) =>
        idempotent(request, reply, async (idempotencyKey) => {
          const body = parse(amountBody, request.body);
          const input = {
            customerId: parse(idParams, request.params).id,
            amount: body.amount,
            idempotencyKey,
            source: 'MINIAPP' as const,
            ...compact({ description: body.description, dateOffsetDays: body.dateOffsetDays }),
          };
          const result =
            kind === 'debt'
              ? await postDebt(pool, request.access!, input)
              : await postPayment(pool, request.access!, input);
          return { status: result.replayed ? 200 : 201, body: result };
        }),
    );
  ledgerWrite('debt', 'ledger.debt');
  ledgerWrite('payment', 'ledger.payment');

  app.post('/api/customers/:id/adjustments', guard('ledger.adjustment'), (request, reply) =>
    idempotent(request, reply, async (idempotencyKey) => {
      const body = parse(adjustmentBody, request.body);
      const result = await postAdjustment(pool, request.access!, {
        customerId: parse(idParams, request.params).id,
        amount: body.amount,
        description: body.description,
        idempotencyKey,
        source: 'MINIAPP',
      });
      return { status: result.replayed ? 200 : 201, body: result };
    }),
  );

  // O'chirish = storno (Q2: xodim ham o'chira oladi; egasiga xabar boradi)
  app.post('/api/entries/:id/delete', guard('ledger.entry.delete'), (request, reply) =>
    idempotent(request, reply, async (idempotencyKey) => {
      const entryId = parse(idParams, request.params).id;
      const { reason } = parse(deleteBody, request.body ?? {});
      const access = request.access!;
      const detail = await getEntry(pool, access, entryId); // boshqa biznes yozuvi → 404
      const result = await deleteEntry(pool, access, {
        entryId,
        idempotencyKey,
        source: 'MINIAPP',
        ...compact({ reason }),
      });
      if (result.notifyOwner) {
        const user = request.user!;
        await notifyOwnerOfDeletion(
          { pool, logger: deps.logger, send: deps.send },
          access,
          {
            name: user.firstName ?? user.username ?? String(user.telegramUserId),
            telegramUserId: user.telegramUserId,
          },
          detail,
          result.balance,
        );
      }
      return {
        status: 200,
        body: {
          entry: result.entry,
          original: result.original,
          balance: result.balance,
          replayed: result.replayed,
        },
      };
    }),
  );

  // ───────── Xodimlar (TT §34) ─────────
  app.get('/api/staff', guard('staff.manage'), async (request) => ({
    members: await listStaff(pool, request.access!),
  }));

  app.post('/api/staff/invites', guard('staff.manage'), (request, reply) =>
    idempotent(request, reply, async () => {
      const invite = await createInvite(pool, request.access!);
      return {
        status: 201,
        body: {
          link: `https://t.me/${deps.botUsername()}?start=inv_${invite.token}`,
          expiresAt: invite.expiresAt,
        },
      };
    }),
  );

  app.post('/api/staff/:userId/revoke', guard('staff.manage'), async (request) =>
    revokeMember(pool, request.access!, parse(userParams, request.params).userId),
  );

  // ───────── Biznes sozlamalari va obuna ─────────
  app.get('/api/business', guard('customer.view'), async (request) =>
    getBusinessSettings(pool, request.access!),
  );
  app.patch('/api/business', guard('business.settings'), async (request) =>
    updateBusinessSettings(pool, request.access!, request.body),
  );

  app.get('/api/billing', guard('billing.view'), async (request) => {
    const access = request.access!;
    const [billing, settings] = await Promise.all([
      loadBilling(pool, access),
      getBusinessSettings(pool, access),
    ]);
    return {
      status: billing.status,
      trialEndsAt: billing.trialEndsAt,
      paidUntil: billing.paidUntil,
      shortCode: settings.shortCode,
      priceUzs: deps.config.billing.priceUzs,
      supportPhone: deps.config.billing.supportPhone ?? null,
    };
  });
}
