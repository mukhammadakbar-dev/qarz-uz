import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import {
  schemas,
  registerShopCtrl,
  registerPersonalCtrl,
  loginCtrl,
  changePasswordCtrl,
  requestRegisterOtpCtrl,
  requestTelegramLinkCtrl,
  confirmTelegramLinkCtrl,
  refreshCtrl,
  directLinkByContactCtrl,
  webRegisterCodeCtrl,
  loginTelegramWebAppCtrl,
  requestPasswordResetCtrl,
  resetPasswordCtrl,
  webResetCodeCtrl,
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

// Set/change own password. Authenticated: this is the account holder acting on
// their own account, not a recovery flow.
router.patch(
  '/password',
  authenticate,
  validate(schemas.changePassword),
  changePasswordCtrl
);

// --- Forgot password (public, proven with a bot-delivered OTP) ---
// Same limiters as registration: the request side is an OTP send in all but
// name, and the reset side is an OTP verify (per-code attempts capped at 5 in
// the OTP service on top of this).
router.post(
  '/password/request-reset',
  otpRequestLimiter,
  validate(schemas.requestPasswordReset),
  requestPasswordResetCtrl
);
router.post(
  '/password/reset',
  otpConfirmLimiter,
  validate(schemas.resetPassword),
  resetPasswordCtrl
);
// Bot-only (shared secret enforced in the controller): the reset code the bot
// reads out to someone who asked for one on the website.
router.post(
  '/telegram/web-reset-code',
  validate(schemas.webRegisterCode),
  webResetCodeCtrl
);

// Bot-only (shared secret enforced in the controller): the code the bot shows
// to someone registering on the website.
router.post(
  '/telegram/web-code',
  validate(schemas.webRegisterCode),
  webRegisterCodeCtrl
);

// Mini App launch auth. Sits under the blanket /api/auth rate limit like
// every other route here; no phone in the body to key a finer limiter on,
// and the signature check is itself the gate.
router.post(
  '/telegram/webapp',
  validate(schemas.telegramWebApp),
  loginTelegramWebAppCtrl
);

router.post(
  '/telegram/direct-link',
  validate(schemas.directLink),
  directLinkByContactCtrl
);

export default router;
