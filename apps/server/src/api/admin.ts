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
import { NotFoundError, ValidationError } from '../errors/index.js';
import { createAuthenticate } from '../http/auth.js';
import { t } from '../i18n/index.js';
import {
  BroadcastSender,
  countRecipients,
  createBroadcast,
  listBroadcasts,
  SEGMENTS,
} from '../modules/admin/broadcast.js';
import {
  adminAudit,
  adminStats,
  extendSubscription,
  getAdminBusiness,
  listBusinesses,
  setSuspended,
} from '../modules/admin/service.js';
import { getCustomer, searchCustomers } from '../modules/customers/index.js';
import type { User } from '../modules/identity/index.js';
import { getHistory } from '../modules/ledger/index.js';
import type { BusinessAccess } from '../modules/tenancy/index.js';
import type { Logger } from '../observability/logger.js';
import { runIdempotent } from './idempotency.js';

/**
 * Superadmin API (ADR-0008). Kirish: sessiya + Telegram ID `SUPERADMIN_TELEGRAM_IDS` da. Boshqalarga 404
 * (panel borligi ham bilinmasin). Do'kon ichidagi ma'lumot faqat O'QILADI va har bir ko'rish audit'ga yoziladi.
 */

export interface AdminApiDeps {
  readonly config: Pick<Config, 'telegram' | 'session' | 'billing'>;
  readonly pool: Pool;
  /** `nasiya_system` (BYPASSRLS): do'konlararo ro'yxat, obuna, bloklash, broadcast. */
  readonly sys: Pool;
  readonly logger: Logger;
  readonly broadcasts: BroadcastSender;
  readonly send: (chatId: number, text: string) => Promise<unknown>;
}

type App<L extends FastifyBaseLogger> = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  L
>;

export const isSuperadmin = (
  config: Pick<Config, 'billing'>,
  user: Pick<User, 'telegramUserId'>,
): boolean => config.billing.superadminTelegramIds.includes(user.telegramUserId);

const uuid = z.string().regex(/^[0-9a-f-]{36}$/i);
const bizParams = z.object({ id: uuid });
const customerParams = z.object({ id: uuid, customerId: uuid });
const listQuery = z.object({
  q: z.string().max(100).optional(),
  filter: z.enum(['TRIAL', 'ACTIVE', 'EXPIRED', 'SUSPENDED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(400).optional(),
});
const customersQuery = z.object({
  q: z.string().max(100).optional(),
  sort: z.enum(['debt', 'newest', 'name', 'recent']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(400).optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
});
const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(200).optional(),
});
const extendBody = z.object({
  months: z.number().int().min(1).max(36),
  amount: z.number().int().min(1).max(100_000_000).optional(),
  note: z.string().max(300).nullish(),
});
const suspendBody = z.object({ reason: z.string().max(500).nullish() }).default({});
const audienceBody = z.object({
  segments: z
    .array(z.enum(['TRIAL', 'ACTIVE', 'EXPIRED']))
    .min(1)
    .max(3),
  includeStaff: z.boolean(),
});
const broadcastBody = audienceBody.extend({ text: z.string().min(1).max(4000) });

function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new ValidationError('So‘rov noto‘g‘ri', {
      details: { fields: r.error.issues.map((i) => i.path.join('.') || '(tana)') },
    });
  }
  return r.data;
}

const compact = <T extends Record<string, unknown>>(
  o: T,
): { [K in keyof T]: Exclude<T[K], undefined> } =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as never;

const formatDate = (d: Date): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tashkent',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
    .format(d)
    .replaceAll('/', '.');

export function registerAdminApi<L extends FastifyBaseLogger>(
  app: App<L>,
  deps: AdminApiDeps,
): void {
  const { pool, sys, logger } = deps;
  const authenticate = createAuthenticate({ config: deps.config, pool });

  const requireSuperadmin = async (request: FastifyRequest): Promise<void> => {
    await authenticate(request);
    if (!isSuperadmin(deps.config, request.user!)) throw new NotFoundError();
  };
  const guard = { preHandler: requireSuperadmin };
  const admin = (request: FastifyRequest) => request.user!;

  /** Do'kon ichini O'QISH uchun: RLS tanlangan do'kon bilan cheklanadi; a'zolik yo'q — yozuv servislari rad etadi. */
  const viewAccess = async (
    request: FastifyRequest,
    businessId: string,
  ): Promise<BusinessAccess> => {
    const { rowCount } = await sys.query('SELECT 1 FROM businesses WHERE id = $1', [businessId]);
    if (!rowCount) throw new NotFoundError('Do‘kon topilmadi');
    return { userId: admin(request).id, businessId, role: 'STAFF' };
  };

  const audit = (
    request: FastifyRequest,
    businessId: string,
    action: string,
    entity: string,
    entityId: string,
  ) => adminAudit(sys, { actorUserId: admin(request).id, businessId, action, entity, entityId });

  /** Egasiga xabar (best-effort): yuborilmasa amal bekor qilinmaydi. */
  const notifyOwner = async (
    businessId: string,
    text: (locale: 'uz-Latn' | 'uz-Cyrl') => string,
  ) => {
    try {
      const { rows } = await sys.query<{ tg: string; locale: 'uz-Latn' | 'uz-Cyrl' }>(
        `SELECT u.telegram_user_id::text AS tg, u.locale
           FROM businesses b JOIN users u ON u.id = b.owner_user_id WHERE b.id = $1`,
        [businessId],
      );
      const owner = rows[0];
      if (owner) await deps.send(Number(owner.tg), text(owner.locale));
    } catch (error) {
      logger.warn({ err: error, businessId }, 'egasiga admin xabari yuborilmadi');
    }
  };

  const idempotent = async (
    request: FastifyRequest,
    reply: FastifyReply,
    execute: () => Promise<{ status: number; body: unknown }>,
  ) => {
    const out = await runIdempotent(pool, request, admin(request).id, execute);
    if (out.replayed) reply.header('idempotent-replayed', 'true');
    return reply.status(out.status).send(out.body);
  };

  // ───────── Umumiy ko'rinish ─────────
  app.get('/api/admin/stats', guard, () => adminStats(sys));

  app.get('/api/admin/businesses', guard, async (request) => {
    const q = parse(listQuery, request.query);
    return listBusinesses(
      sys,
      compact({ q: q.q, filter: q.filter, limit: q.limit, cursor: q.cursor }),
    );
  });

  app.get('/api/admin/businesses/:id', guard, async (request) => {
    const { id } = parse(bizParams, request.params);
    const detail = await getAdminBusiness(sys, id);
    await audit(request, id, 'admin.business.view', 'business', id);
    return { ...detail, priceUzs: deps.config.billing.priceUzs };
  });

  // ───────── Do'kon ichi (faqat o'qish, audit bilan) ─────────
  app.get('/api/admin/businesses/:id/customers', guard, async (request) => {
    const { id } = parse(bizParams, request.params);
    const q = parse(customersQuery, request.query);
    const access = await viewAccess(request, id);
    const page = await searchCustomers(
      pool,
      access,
      compact({
        q: q.q,
        sort: q.sort ?? 'debt',
        limit: q.limit,
        cursor: q.cursor,
        status: q.status,
      }),
    );
    if (!q.cursor) await audit(request, id, 'admin.customers.view', 'business', id);
    return page;
  });

  app.get('/api/admin/businesses/:id/customers/:customerId', guard, async (request) => {
    const { id, customerId } = parse(customerParams, request.params);
    return getCustomer(pool, await viewAccess(request, id), customerId);
  });

  app.get('/api/admin/businesses/:id/customers/:customerId/ledger', guard, async (request) => {
    const { id, customerId } = parse(customerParams, request.params);
    const q = parse(historyQuery, request.query);
    const page = await getHistory(
      pool,
      await viewAccess(request, id),
      customerId,
      compact({ limit: q.limit, cursor: q.cursor }),
    );
    if (!q.cursor) await audit(request, id, 'admin.ledger.view', 'customer', customerId);
    return page;
  });

  // ───────── Obuna va bloklash ─────────
  app.post('/api/admin/businesses/:id/extend', guard, (request, reply) =>
    idempotent(request, reply, async () => {
      const { id } = parse(bizParams, request.params);
      const body = parse(extendBody, request.body);
      const result = await extendSubscription(sys, {
        businessId: id,
        months: body.months,
        amount: body.amount ?? deps.config.billing.priceUzs * body.months,
        note: body.note ?? null,
        actorUserId: admin(request).id,
      });
      await notifyOwner(id, (locale) =>
        t(locale, 'admin.extended', { name: result.name, date: formatDate(result.paidUntil) }),
      );
      return { status: 200, body: { paidUntil: result.paidUntil, periodFrom: result.periodFrom } };
    }),
  );

  app.post('/api/admin/businesses/:id/suspend', guard, async (request) => {
    const { id } = parse(bizParams, request.params);
    const { reason } = parse(suspendBody, request.body);
    const result = await setSuspended(sys, {
      businessId: id,
      suspended: true,
      reason: reason ?? null,
      actorUserId: admin(request).id,
    });
    const { name } = await getAdminBusiness(sys, id);
    await notifyOwner(id, (locale) =>
      t(locale, 'admin.suspended', {
        name,
        reason: reason?.trim() ? t(locale, 'admin.suspendedReason', { reason: reason.trim() }) : '',
      }),
    );
    return result;
  });

  app.post('/api/admin/businesses/:id/unsuspend', guard, async (request) => {
    const { id } = parse(bizParams, request.params);
    const result = await setSuspended(sys, {
      businessId: id,
      suspended: false,
      actorUserId: admin(request).id,
    });
    const { name } = await getAdminBusiness(sys, id);
    await notifyOwner(id, (locale) => t(locale, 'admin.unsuspended', { name }));
    return result;
  });

  // ───────── Broadcast ─────────
  app.post('/api/admin/broadcasts/preview', guard, async (request) => {
    const body = parse(audienceBody, request.body);
    return { recipients: await countRecipients(sys, body) };
  });

  app.post('/api/admin/broadcasts', guard, (request, reply) =>
    idempotent(request, reply, async () => {
      const body = parse(broadcastBody, request.body);
      const created = await createBroadcast(sys, { ...body, actorUserId: admin(request).id });
      // Yuborish fon jarayonida; natija ro'yxatda yangilanib boradi
      void deps.broadcasts
        .kick()
        .catch((error: unknown) => logger.error({ err: error }, 'broadcast xatosi'));
      return { status: 201, body: created };
    }),
  );

  app.get('/api/admin/broadcasts', guard, async () => ({
    items: await listBroadcasts(sys),
    segments: SEGMENTS,
  }));
}
