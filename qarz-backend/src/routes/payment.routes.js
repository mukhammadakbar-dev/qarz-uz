import { Router } from 'express';
import {
  getPayInfo,
  clickPrepare,
  clickComplete,
} from '../controllers/payment.controller.js';

const router = Router();

// Public info for the pay page (no auth)
router.get('/pay/:token', getPayInfo);

// Click webhooks (no auth; secured by signature)
router.post('/webhooks/click/prepare', clickPrepare);
router.post('/webhooks/click/complete', clickComplete);

export default router;
