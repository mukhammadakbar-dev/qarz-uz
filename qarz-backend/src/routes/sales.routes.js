import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { enforceSubscription } from '../middleware/subscription.js';
import { validate } from '../middleware/validate.js';
import {
  salesSchemas,
  upsertDailySales,
  salesRange,
  dashboard,
} from '../controllers/sales.controller.js';
import {
  staffSchemas,
  createStaff,
  listStaff,
  setStaffActive,
  deleteStaff,
} from '../controllers/staff.controller.js';

const router = Router();
router.use(authenticate, authorize('shop_owner', 'staff'));

// --- Daily sales / dashboard ---
// writes go through the subscription gate; reads stay open (view-only mode)
router.post('/daily-sales', enforceSubscription, validate(salesSchemas.upsert), upsertDailySales);
router.get('/daily-sales', validate(salesSchemas.range, 'query'), salesRange);
router.get('/dashboard', dashboard);

// --- Staff management (owner only) ---
router.post(
  '/staff',
  authorize('shop_owner'),
  enforceSubscription,
  validate(staffSchemas.create),
  createStaff
);
router.get('/staff', authorize('shop_owner'), listStaff);
router.patch(
  '/staff/:id/active',
  authorize('shop_owner'),
  enforceSubscription,
  validate(staffSchemas.setActive),
  setStaffActive
);
router.delete('/staff/:id', authorize('shop_owner'), enforceSubscription, deleteStaff);

export default router;
