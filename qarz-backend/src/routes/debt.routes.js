import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { enforceSubscription } from '../middleware/subscription.js';
import { validate } from '../middleware/validate.js';
import {
  debtorSchemas,
  createDebtor,
  listDebtors,
  getDebtor,
  updateDebtor,
  deleteDebtor,
} from '../controllers/debtor.controller.js';
import {
  debtSchemas,
  addDebt,
  debtorHistory,
  payDebt,
  generateLink,
  getDebtReceipt,
} from '../controllers/debt.controller.js';

const router = Router();

// all routes here require an authenticated shop_owner / staff / personal user
router.use(authenticate, authorize('shop_owner', 'staff', 'personal'));

// Route params land in UUID columns, so reject malformed ids up front with a
// 422 instead of letting the driver raise a data-type error mid-query.
const uuidId = validate(debtSchemas.idParam, 'params');
const uuidDebtorId = validate(debtSchemas.debtorIdParam, 'params');

// --- Debtors ---
// writes are gated on an active subscription; reads remain available
router.post('/debtors', enforceSubscription, validate(debtorSchemas.create), createDebtor);
router.get('/debtors', validate(debtorSchemas.list, 'query'), listDebtors);
router.get('/debtors/:id', uuidId, getDebtor);
router.patch('/debtors/:id', uuidId, enforceSubscription, validate(debtorSchemas.update), updateDebtor);
router.delete('/debtors/:id', uuidId, enforceSubscription, deleteDebtor);
router.get('/debtors/:debtorId/debts', uuidDebtorId, debtorHistory);

// --- Debts ---
router.post('/debts', enforceSubscription, validate(debtSchemas.create), addDebt);
router.get('/debts/:id/receipt', uuidId, getDebtReceipt);
router.post('/debts/:id/payments', uuidId, enforceSubscription, validate(debtSchemas.pay), payDebt);
router.post('/debts/:id/payment-link', uuidId, enforceSubscription, generateLink);

export default router;
