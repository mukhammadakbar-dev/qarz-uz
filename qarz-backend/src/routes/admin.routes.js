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
} from '../controllers/admin.controller.js';

const router = Router();

// Super Admin panel — completely separate, super_admin role only
router.use(authenticate, authorize('super_admin'));

router.get('/shops', validate(adminSchemas.listShops, 'query'), listShops);
router.get('/stats', platformStats);
router.get('/plans', listPlans);
router.patch('/plans/:code', validate(adminSchemas.updatePlan), updatePlan);
router.patch('/shops/:shopId/active', validate(adminSchemas.setShopActive), setShopActive);
router.get('/audit-log', auditLog);

export default router;
