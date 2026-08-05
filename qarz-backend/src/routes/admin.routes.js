import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  adminSchemas,
  listShops,
  platformStats,
  listPlans,
  updatePlan,
  setShopActive,
  auditLog,
  broadcast,
  extendSubscription,
  listSubscriptionPayments,
} from '../controllers/admin.controller.js';

const router = Router();

// Super Admin panel — completely separate, super_admin role only
router.use(authenticate, authorize('super_admin'));

router.get('/shops', validate(adminSchemas.listShops, 'query'), listShops);
router.get('/stats', platformStats);
router.get('/plans', listPlans);
router.patch(
  '/plans/:code',
  validate(adminSchemas.planCodeParam, 'params'),
  validate(adminSchemas.updatePlan),
  updatePlan
);
router.patch(
  '/shops/:shopId/active',
  validate(adminSchemas.shopIdParam, 'params'),
  validate(adminSchemas.setShopActive),
  setShopActive
);
// Manual subscription activation — how shops are billed until Click is live.
router.patch(
  '/shops/:shopId/subscription',
  validate(adminSchemas.shopIdParam, 'params'),
  validate(adminSchemas.extendSubscription),
  extendSubscription
);
router.get(
  '/shops/:shopId/subscription-payments',
  validate(adminSchemas.shopIdParam, 'params'),
  listSubscriptionPayments
);

router.get('/audit-log', auditLog);
router.post('/broadcast', validate(adminSchemas.broadcast), broadcast);

export default router;
