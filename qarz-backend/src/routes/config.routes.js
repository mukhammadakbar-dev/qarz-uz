import { Router } from 'express';
import { config } from '../config/index.js';

const router = Router();

router.get('/sms-status', (_req, res) => {
  const configured = Boolean(config.eskiz.email && config.eskiz.password);
  res.json({ configured });
});

export default router;
