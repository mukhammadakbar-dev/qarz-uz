import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import authRoutes from './routes/auth.routes.js';
import debtRoutes from './routes/debt.routes.js';
import salesRoutes from './routes/sales.routes.js';
import adminRoutes from './routes/admin.routes.js';
import paymentRoutes from './routes/payment.routes.js';

import { notFoundHandler, errorHandler } from './middleware/error.js';

export const createApp = () => {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true })); // Click webhooks post form data
  app.use(morgan('dev'));

  // basic rate limit on auth to slow brute-force
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50 });

  app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

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
  app.use('/api/admin', adminRoutes); // Super Admin panel API
  app.use('/api', debtRoutes);        // /api/debtors, /api/debts (broadest, so last)
  app.use('/', paymentRoutes);        // /pay/:token, /webhooks/click/*

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
