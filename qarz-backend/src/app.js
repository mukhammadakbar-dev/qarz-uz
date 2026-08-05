import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { config } from './config/index.js';
import { ping } from './db/pool.js';
import { hasBotSecret } from './middleware/botAuth.js';

import authRoutes from './routes/auth.routes.js';
import debtRoutes from './routes/debt.routes.js';
import salesRoutes from './routes/sales.routes.js';
import adminRoutes from './routes/admin.routes.js';
import paymentRoutes from './routes/payment.routes.js';
import configRoutes from './routes/config.routes.js';
import botSessionRoutes from './routes/botSession.routes.js';

import { notFoundHandler, errorHandler } from './middleware/error.js';

export const createApp = () => {
  const app = express();

  // req.ip drives the auth rate limiters. Behind a proxy every request
  // otherwise appears to come from the proxy's address, collapsing all users
  // into one bucket; exposed directly, blindly trusting X-Forwarded-For would
  // let a client spoof it and sidestep the limits. So trust exactly as many
  // hops as the deployment actually has (TRUST_PROXY), and none by default.
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    cors({
      // Wide open by default (dev); pin to an allowlist in production via
      // CORS_ORIGINS so a hostile page cannot drive the API from a browser.
      origin: config.corsOrigins.length ? config.corsOrigins : true,
      credentials: false,
    })
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' })); // Click webhooks post form data
  // 'dev' is colourised and lossy; production wants a parseable access log.
  app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));

  /**
   * These limits are keyed on req.ip, which makes our own Telegram bot a
   * problem: it is a single process behind a single address, so every one of
   * its users shares one bucket and a busy bot throttles itself. It is trusted
   * infrastructure holding a server-side secret, not an anonymous client, so
   * it is exempt — and if that secret ever leaks, unmetered API calls are far
   * from the worst an attacker could do with it (see botAuth.js).
   */
  const isExemptFromLimits = (req) => req.path.startsWith('/health') || hasBotSecret(req);

  // Blanket ceiling so no single client can saturate the API; the tight,
  // targeted limits live on the auth routes.
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: 300,
      standardHeaders: true,
      legacyHeaders: false,
      skip: isExemptFromLimits,
    })
  );

  // basic rate limit on auth to slow brute-force
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    standardHeaders: true,
    legacyHeaders: false,
    skip: isExemptFromLimits,
  });

  // Liveness: the process is up and the event loop is turning. Deliberately
  // does NOT touch the database — a restart cannot fix a down Postgres, so an
  // orchestrator must not kill the container over it.
  app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

  // Readiness: can this instance actually serve requests? Every meaningful
  // route hits Postgres, so a load balancer should stop sending traffic here
  // while the database is unreachable. 503 is what makes that happen.
  app.get('/health/ready', async (_req, res) => {
    const dbOk = await ping();
    res.status(dbOk ? 200 : 503).json({ ok: dbOk, db: dbOk ? 'up' : 'down', ts: Date.now() });
  });

  app.use('/api/auth', authLimiter, authRoutes);
  // IMPORTANT: mount the more specific prefixes (/api/shop, /api/admin) BEFORE
  // the generic '/api' prefix used by debtRoutes. Express matches app.use()
  // mounts in registration order by prefix, so if the broad '/api' mount came
  // first, EVERY request under /api/shop/* and /api/admin/* would first pass
  // through debtRoutes' own `authorize('shop_owner','staff','personal')` gate.
  // For shop_owner/staff/personal this was invisible (they're on that list,
  // and debtRoutes simply has no matching route so it falls through) — but
  // for super_admin it was a hard rejection: authorize() calls next(Forbidden())
  // which short-circuits straight to the error handler, so every single
  // /api/admin/* request returned 403 before ever reaching adminRoutes.
  app.use('/api/shop', salesRoutes);  // /api/shop/dashboard, daily-sales, staff
  app.use('/api/bot', botSessionRoutes); // bot's own session store (shared-secret gated)
  app.use('/api/admin', adminRoutes); // Super Admin panel API
  app.use('/api/config', configRoutes);
  app.use('/api', debtRoutes);        // /api/debtors, /api/debts (broadest, so last)
  app.use('/', paymentRoutes);        // /pay/:token, /webhooks/click/*

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
