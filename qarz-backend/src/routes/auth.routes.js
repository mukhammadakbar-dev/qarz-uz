import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validate } from '../middleware/validate.js';
import {
  schemas,
  registerShopCtrl,
  registerPersonalCtrl,
  loginCtrl,
  requestRegisterOtpCtrl,
  requestTelegramLinkCtrl,
  confirmTelegramLinkCtrl,
  refreshCtrl,
  getVerifyStatusCtrl,
  confirmVerifyTokenCtrl,
  directLinkByContactCtrl,
} from '../controllers/auth.controller.js';
import { normalizePhone } from '../utils/phone.js';

const router = Router();

/**
 * Rate limit keyed by IP *and* phone, so an attacker cannot spread attempts
 * across many phones from one IP, nor across many IPs against one phone.
 */
const byIpAndPhone = (windowMs, max) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const phone = normalizePhone(req.body?.phone) || 'nophone';
      return `${req.ip}:${phone}`;
    },
    message: {
      error: {
        code: 'RATE_LIMITED',
        message: 'Juda ko\'p urinish. Bir ozdan keyin qayta urinib ko\'ring.',
      },
    },
  });

// OTP send: 5 per hour per (IP, phone)
const otpRequestLimiter = byIpAndPhone(60 * 60 * 1000, 5);
// OTP verify: 10 per hour per (IP, phone) — per-code attempts also capped at 5 in the service
const otpConfirmLimiter = byIpAndPhone(60 * 60 * 1000, 10);

router.post(
  '/register/request-otp',
  otpRequestLimiter,
  validate(schemas.requestRegisterOtp),
  requestRegisterOtpCtrl
);
router.post('/register/shop', validate(schemas.registerShop), registerShopCtrl);
router.post('/register/personal', validate(schemas.registerPersonal), registerPersonalCtrl);
router.post('/login', validate(schemas.login), loginCtrl);

// --- Two-step Telegram linking (replaces the old one-shot /telegram/link) ---
router.post(
  '/telegram/request-link',
  otpRequestLimiter,
  validate(schemas.requestTelegramLink),
  requestTelegramLinkCtrl
);
router.post(
  '/telegram/confirm-link',
  otpConfirmLimiter,
  validate(schemas.confirmTelegramLink),
  confirmTelegramLinkCtrl
);

// Legacy endpoint: removed for security. Point callers at the new flow.
router.post('/telegram/link', (_req, res) => {
  res.status(410).json({
    error: {
      code: 'ENDPOINT_REMOVED',
      message:
        'Bu endpoint xavfsizlik sababli olib tashlandi. /api/auth/telegram/request-link va /confirm-link dan foydalaning.',
    },
  });
});

router.post('/refresh', validate(schemas.refresh), refreshCtrl);

// --- Telegram registration handshake ---
// Polled by the registration page; returns only a boolean, never the proof.
router.get(
  '/verify-status/:token',
  validate(schemas.verifyStatusParam, 'params'),
  getVerifyStatusCtrl
);
// Bot-only (shared secret enforced in the controller).
router.post(
  '/telegram/confirm-verify-token',
  validate(schemas.confirmVerifyToken),
  confirmVerifyTokenCtrl
);
router.post(
  '/telegram/direct-link',
  validate(schemas.directLink),
  directLinkByContactCtrl
);

export default router;
