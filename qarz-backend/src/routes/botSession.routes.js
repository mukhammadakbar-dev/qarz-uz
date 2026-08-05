import { Router } from 'express';
import { requireBotSecret } from '../middleware/botAuth.js';
import { validate } from '../middleware/validate.js';
import {
  schemas,
  listSessionsCtrl,
  putSessionCtrl,
  deleteSessionCtrl,
} from '../controllers/botSession.controller.js';

const router = Router();

// One gate for the whole tree: these endpoints expose sessions across all bot
// users, so they are only ever reachable by our own bot process.
router.use(requireBotSecret);

router.get('/sessions', listSessionsCtrl);

router.put(
  '/sessions/:telegramId',
  validate(schemas.telegramIdParam, 'params'),
  validate(schemas.sessionBody),
  putSessionCtrl
);

router.delete(
  '/sessions/:telegramId',
  validate(schemas.telegramIdParam, 'params'),
  deleteSessionCtrl
);

export default router;
