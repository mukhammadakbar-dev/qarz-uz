import type {
  FastifyBaseLogger,
  FastifyInstance,
  FastifyRequest,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { Config } from '../config/index.js';
import { UnauthorizedError, ValidationError } from '../errors/index.js';
import {
  findUserById,
  issueSessionToken,
  upsertTelegramUser,
  verifyInitData,
  verifySessionToken,
  type User,
} from '../modules/identity/index.js';
import { setContext } from '../observability/context.js';
import {
  listMemberships,
  requirePermission,
  resolveBusinessAccess,
  type BusinessAccess,
  type Permission,
} from '../modules/tenancy/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** `authenticate` preHandler o'rnatadi. */
    user?: User;
    /** `requireBusiness` preHandler o'rnatadi (a'zolik server tomonida tasdiqlangan). */
    access?: BusinessAccess;
  }
}

export interface AuthDeps {
  readonly config: Pick<Config, 'telegram' | 'session'>;
  readonly pool: Pool;
}

const loginBody = z.object({ initData: z.string().min(1).max(8192) });

/** Bearer token → request.user. Foydalanuvchi DB'da bo'lishi shart. */
export function createAuthenticate(deps: AuthDeps) {
  return async function authenticate(request: FastifyRequest): Promise<void> {
    const header = request.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new UnauthorizedError();
    }
    const userId = verifySessionToken(header.slice('Bearer '.length), {
      secret: deps.config.session.secret,
    });
    const user = await findUserById(deps.pool, userId);
    if (!user) throw new UnauthorizedError('Sessiya yaroqsiz, ilovani qayta oching');
    request.user = user;
    setContext({ userId: user.id });
  };
}

/**
 * Autentifikatsiya + aktiv biznes + (ixtiyoriy) permission. `X-Business-Id` faqat selector:
 * a'zolik va rol har so'rovda DB'dan tekshiriladi.
 */
export function createRequireBusiness(deps: AuthDeps) {
  const authenticate = createAuthenticate(deps);
  return function requireBusiness(permission?: Permission) {
    return async function requireBusinessHook(request: FastifyRequest): Promise<void> {
      await authenticate(request);
      const raw = request.headers['x-business-id'];
      const selector = Array.isArray(raw) ? raw[0] : raw;
      const access = await resolveBusinessAccess(deps.pool, request.user!, selector);
      if (permission) requirePermission(access, permission);
      request.access = access;
      setContext({ businessId: access.businessId });
    };
  };
}

const publicUser = (u: User) => ({
  id: u.id,
  firstName: u.firstName,
  username: u.username,
  locale: u.locale,
});

export function registerAuthRoutes<L extends FastifyBaseLogger>(
  app: FastifyInstance<RawServerDefault, RawRequestDefaultExpression, RawReplyDefaultExpression, L>,
  deps: AuthDeps,
): void {
  const authenticate = createAuthenticate(deps);

  app.post('/api/auth/telegram', async (request) => {
    const parsed = loginBody.safeParse(request.body);
    if (!parsed.success) throw new ValidationError('initData majburiy');
    const verified = verifyInitData(parsed.data.initData, {
      botToken: deps.config.telegram.botToken,
      maxAgeSeconds: deps.config.session.initDataMaxAgeSeconds,
    });
    const user = await upsertTelegramUser(deps.pool, verified.user);
    setContext({ userId: user.id });
    const { token, expiresAt } = issueSessionToken(user.id, {
      secret: deps.config.session.secret,
      ttlSeconds: deps.config.session.ttlSeconds,
    });
    return { token, expiresAt, user: publicUser(user) };
  });

  app.get('/api/me', { preHandler: authenticate }, async (request) => {
    const user = request.user!;
    const memberships = await listMemberships(deps.pool, user.id);
    return {
      user: publicUser(user),
      activeBusinessId: user.activeBusinessId,
      businesses: memberships.map((m) => ({ id: m.businessId, name: m.name, role: m.role })),
    };
  });
}
