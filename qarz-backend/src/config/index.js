import dotenv from 'dotenv';
dotenv.config();

const isProd = process.env.NODE_ENV === 'production';

/**
 * Secrets that must never fall back to a development default in production.
 * A predictable JWT or payment-link secret would let anyone mint valid tokens.
 */
const PROD_REQUIRED_SECRETS = [
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'PAYMENT_LINK_SECRET',
];

/**
 * Values shipped in .env.example / used as dev fallbacks. Copying .env.example
 * to production would otherwise satisfy a mere "is it set?" check while leaving
 * publicly-known secrets in place, so these are rejected explicitly.
 */
const INSECURE_SECRET_VALUES = new Set([
  'change-me-access',
  'change-me-refresh',
  'change-me-paylink',
  'dev-access-secret-change-me',
  'dev-refresh-secret-change-me',
  'dev-paylink-secret-change-me',
]);

const MIN_SECRET_LENGTH = 16;

if (isProd) {
  const problems = [];
  for (const key of PROD_REQUIRED_SECRETS) {
    const val = process.env[key];
    if (!val) {
      problems.push(`${key} is not set`);
    } else if (INSECURE_SECRET_VALUES.has(val.trim())) {
      problems.push(`${key} still uses the example placeholder value`);
    } else if (val.trim().length < MIN_SECRET_LENGTH) {
      problems.push(`${key} is shorter than ${MIN_SECRET_LENGTH} characters`);
    }
  }

  if (problems.length) {
    console.error(
      '[config] FATAL: insecure production configuration:\n' +
        problems.map((p) => `  - ${p}`).join('\n') +
        '\n[config] Generate strong secrets, e.g. `openssl rand -hex 32`.\n' +
        '[config] Refusing to start.'
    );
    process.exit(1);
  }
}

const required = (key, fallback) => {
  const val = process.env[key] ?? fallback;
  if (val === undefined) {
    console.warn(`[config] Missing env var: ${key}`);
  }
  return val;
};

/** Comma-separated env list -> trimmed, non-empty array. */
const list = (val) =>
  String(val || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),

  /**
   * Browser origins allowed to call the API. Empty = allow any origin, which is
   * the convenient default for local development but must be pinned down in
   * production (set CORS_ORIGINS).
   */
  corsOrigins: list(process.env.CORS_ORIGINS),

  /**
   * How many reverse proxies sit in front of the app. Needed for req.ip to be
   * the real client rather than the proxy — the auth rate limits are keyed on
   * it, so getting this wrong buckets every user together. Number, or `false`
   * when the app is exposed directly.
   */
  trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : false,

  db: {
    host: required('DB_HOST', 'localhost'),
    port: parseInt(required('DB_PORT', '5432'), 10),
    user: required('DB_USER', 'postgres'),
    password: required('DB_PASSWORD', 'postgres'),
    database: required('DB_NAME', 'qarz'),
  },

  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET', 'dev-access-secret-change-me'),
    refreshSecret: required('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-me'),
    accessTtl: process.env.JWT_ACCESS_TTL || '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL || '30d',
    // secret used to sign one-time payment link tokens
    paymentLinkSecret: required('PAYMENT_LINK_SECRET', 'dev-paylink-secret-change-me'),
  },

  // trial period for new shops (days)
  trialDays: parseInt(process.env.TRIAL_DAYS || '14', 10),

  // default free SMS per month for overdue reminders
  defaultSmsLimit: parseInt(process.env.DEFAULT_SMS_LIMIT || '30', 10),

  // how long a payment link stays valid (hours)
  paymentLinkTtlHours: parseInt(process.env.PAYMENT_LINK_TTL_HOURS || '48', 10),

  // public base URL used to build payment links
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:4000',

  click: {
    serviceId: process.env.CLICK_SERVICE_ID || '',
    merchantId: process.env.CLICK_MERCHANT_ID || '',
    secretKey: process.env.CLICK_SECRET_KEY || '',
  },

  eskiz: {
    email: process.env.ESKIZ_EMAIL || '',
    password: process.env.ESKIZ_PASSWORD || '',
    from: process.env.ESKIZ_FROM || '4546',
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    // used to build t.me deep links for the Telegram registration handshake
    botUsername: (process.env.TELEGRAM_BOT_USERNAME || 'tDaftar_bot').replace(/^@/, ''),
  },

  /**
   * Shared secret proving a request came from our own Telegram bot (sent as the
   * x-bot-secret header). Lets the bot skip the registration OTP, since a shared
   * contact in a Telegram session already proves phone ownership.
   * If unset, the bot gets no privilege and must supply an OTP like anyone else.
   */
  botSharedSecret: process.env.BOT_SHARED_SECRET || '',
};
