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
  app.use('/api', debtRoutes);        // /api/debtors, /api/debts
  app.use('/api/shop', salesRoutes);  // /api/shop/dashboard, daily-sales
  app.use('/api/admin', adminRoutes); // Super Admin panel API
  app.use('/', paymentRoutes);        // /pay/:token, /webhooks/click/*

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
