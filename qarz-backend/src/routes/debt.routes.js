import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { enforceSubscription } from '../middleware/subscription.js';
import { validate } from '../middleware/validate.js';
import {
  debtorSchemas,
  createDebtor,
  listDebtors,
  getDebtor,
} from '../controllers/debtor.controller.js';
import {
  debtSchemas,
  addDebt,
  debtorHistory,
  payDebt,
  generateLink,
} from '../controllers/debt.controller.js';

const router = Router();

// all routes here require an authenticated shop_owner / staff / personal user
router.use(authenticate, authorize('shop_owner', 'staff', 'personal'));

// --- Debtors ---
// writes are gated on an active subscription; reads remain available
router.post('/debtors', enforceSubscription, validate(debtorSchemas.create), createDebtor);
router.get('/debtors', validate(debtorSchemas.list, 'query'), listDebtors);
router.get('/debtors/:id', getDebtor);
router.get('/debtors/:debtorId/debts', debtorHistory);

// --- Debts ---
router.post('/debts', enforceSubscription, validate(debtSchemas.create), addDebt);
router.post('/debts/:id/payments', enforceSubscription, validate(debtSchemas.pay), payDebt);
router.post('/debts/:id/payment-link', enforceSubscription, generateLink);

export default router;
