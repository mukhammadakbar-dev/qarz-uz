import { z } from 'zod';

/**
 * Konfiguratsiya faqat env orqali, zod bilan validatsiya qilinadi (ADR-0001).
 * Qiymat yetishmasa yoki noto'g'ri bo'lsa jarayon ishga tushmaydi (fail-fast).
 * Xato xabarlarida secret qiymatlari ko'rsatilmaydi, faqat o'zgaruvchi nomi.
 */

const csvPositiveInts = z
  .string()
  .default('')
  .transform((s) =>
    s
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean),
  )
  .transform((parts) => parts.map(Number))
  .pipe(z.array(z.number().int().positive()));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().min(1).default('127.0.0.1'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    // Postgres: `app` roli (ledger ustida faqat INSERT/SELECT). Migratsiya alohida rol bilan.
    DATABASE_URL: z
      .string()
      .min(1)
      .regex(/^postgres(ql)?:\/\//, 'postgres:// URL bo‘lishi kerak'),
    MIGRATOR_DATABASE_URL: optionalString,
    // `nasiya_system` (BYPASSRLS): faqat cron va superadmin billing uchun, alohida pool.
    SYSTEM_DATABASE_URL: optionalString,

    // Telegram
    TELEGRAM_BOT_TOKEN: z.string().regex(/^\d+:[\w-]{20,}$/, 'bot token formati noto‘g‘ri'),
    // Telegram `secret_token`: 1-256 belgi, faqat A-Z a-z 0-9 _ -
    TELEGRAM_WEBHOOK_SECRET: z
      .string()
      .min(16)
      .max(256)
      .regex(/^[A-Za-z0-9_-]+$/, 'faqat A-Z a-z 0-9 _ - ruxsat etiladi'),
    TELEGRAM_MODE: z.enum(['webhook', 'polling']).optional(),
    PUBLIC_BASE_URL: optionalString.pipe(z.url().optional()),
    MINIAPP_URL: optionalString.pipe(z.url().optional()),

    // Mini App sessiyasi (ADR-0006)
    SESSION_SECRET: z.string().min(32, 'kamida 32 belgi'),
    SESSION_TTL_SECONDS: z.coerce.number().int().min(60).default(3600),
    INITDATA_MAX_AGE_SECONDS: z.coerce.number().int().min(60).default(86400),

    // Billing (ADR-0005)
    SUPERADMIN_TELEGRAM_IDS: csvPositiveInts,
    SUPPORT_TELEGRAM_USERNAME: optionalString,
    SUBSCRIPTION_PRICE_UZS: z.coerce.number().int().positive().default(29000),
    TRIAL_DAYS: z.coerce.number().int().min(0).max(365).default(14),

    // AI (ADR-0004). Ikkalasi ham berilsa Gemini yoqiladi, aks holda faqat RuleProvider.
    GEMINI_API_KEY: optionalString,
    GEMINI_MODEL: optionalString,

    SENTRY_DSN: optionalString.pipe(z.url().optional()),
  })
  .superRefine((env, ctx) => {
    const mode = env.TELEGRAM_MODE ?? (env.NODE_ENV === 'production' ? 'webhook' : 'polling');
    if (mode === 'webhook' && !env.PUBLIC_BASE_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['PUBLIC_BASE_URL'],
        message: 'webhook rejimida PUBLIC_BASE_URL majburiy',
      });
    }
    if (env.NODE_ENV === 'production') {
      if (env.PUBLIC_BASE_URL && !env.PUBLIC_BASE_URL.startsWith('https://')) {
        ctx.addIssue({
          code: 'custom',
          path: ['PUBLIC_BASE_URL'],
          message: 'production da https:// bo‘lishi kerak',
        });
      }
      if (mode !== 'webhook') {
        ctx.addIssue({
          code: 'custom',
          path: ['TELEGRAM_MODE'],
          message: 'production da faqat webhook rejimi',
        });
      }
    }
    if (Boolean(env.GEMINI_API_KEY) !== Boolean(env.GEMINI_MODEL)) {
      ctx.addIssue({
        code: 'custom',
        path: ['GEMINI_MODEL'],
        message: 'GEMINI_API_KEY va GEMINI_MODEL birga berilishi kerak',
      });
    }
  });

export interface Config {
  readonly env: 'development' | 'test' | 'production';
  readonly isProduction: boolean;
  readonly http: { readonly host: string; readonly port: number };
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  readonly db: {
    readonly url: string;
    readonly migratorUrl: string | undefined;
    readonly systemUrl: string | undefined;
  };
  readonly telegram: {
    readonly botToken: string;
    readonly webhookSecret: string;
    readonly mode: 'webhook' | 'polling';
    readonly publicBaseUrl: string | undefined;
    readonly miniAppUrl: string | undefined;
  };
  readonly session: {
    readonly secret: string;
    readonly ttlSeconds: number;
    readonly initDataMaxAgeSeconds: number;
  };
  readonly billing: {
    readonly superadminTelegramIds: readonly number[];
    readonly supportUsername: string | undefined;
    readonly priceUzs: number;
    readonly trialDays: number;
  };
  readonly ai: { readonly gemini: { readonly apiKey: string; readonly model: string } | undefined };
  readonly sentryDsn: string | undefined;
}

export class ConfigError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Noto‘g‘ri konfiguratsiya:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(source: Readonly<Record<string, string | undefined>>): Config {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    // Faqat o'zgaruvchi nomi va sabab; kiritilgan qiymat hech qachon xabarga qo'shilmaydi.
    throw new ConfigError(
      parsed.error.issues.map((i) => `${i.path.join('.') || '(env)'}: ${i.message}`),
    );
  }
  const e = parsed.data;
  const production = e.NODE_ENV === 'production';
  const gemini =
    e.GEMINI_API_KEY && e.GEMINI_MODEL
      ? { apiKey: e.GEMINI_API_KEY, model: e.GEMINI_MODEL }
      : undefined;

  return Object.freeze({
    env: e.NODE_ENV,
    isProduction: production,
    http: Object.freeze({ host: e.HOST, port: e.PORT }),
    logLevel: e.LOG_LEVEL,
    db: Object.freeze({
      url: e.DATABASE_URL,
      migratorUrl: e.MIGRATOR_DATABASE_URL,
      systemUrl: e.SYSTEM_DATABASE_URL,
    }),
    telegram: Object.freeze({
      botToken: e.TELEGRAM_BOT_TOKEN,
      webhookSecret: e.TELEGRAM_WEBHOOK_SECRET,
      mode: e.TELEGRAM_MODE ?? (production ? 'webhook' : 'polling'),
      publicBaseUrl: e.PUBLIC_BASE_URL?.replace(/\/+$/, ''),
      miniAppUrl: e.MINIAPP_URL,
    }),
    session: Object.freeze({
      secret: e.SESSION_SECRET,
      ttlSeconds: e.SESSION_TTL_SECONDS,
      initDataMaxAgeSeconds: e.INITDATA_MAX_AGE_SECONDS,
    }),
    billing: Object.freeze({
      superadminTelegramIds: Object.freeze([...e.SUPERADMIN_TELEGRAM_IDS]),
      supportUsername: e.SUPPORT_TELEGRAM_USERNAME?.replace(/^@/, ''),
      priceUzs: e.SUBSCRIPTION_PRICE_UZS,
      trialDays: e.TRIAL_DAYS,
    }),
    ai: Object.freeze({ gemini }),
    sentryDsn: e.SENTRY_DSN,
  });
}

const mask = (v: string | undefined) => (v ? '***' : undefined);

/** Startap logi uchun: secretlar yashirilgan ko'rinish. */
export function redactConfig(config: Config): Record<string, unknown> {
  return {
    env: config.env,
    http: config.http,
    logLevel: config.logLevel,
    db: {
      url: mask(config.db.url),
      migratorUrl: mask(config.db.migratorUrl),
      systemUrl: mask(config.db.systemUrl),
    },
    telegram: {
      botToken: mask(config.telegram.botToken),
      webhookSecret: mask(config.telegram.webhookSecret),
      mode: config.telegram.mode,
      publicBaseUrl: config.telegram.publicBaseUrl,
      miniAppUrl: config.telegram.miniAppUrl,
    },
    session: { secret: mask(config.session.secret), ttlSeconds: config.session.ttlSeconds },
    billing: {
      ...config.billing,
      superadminTelegramIds: config.billing.superadminTelegramIds.length,
    },
    ai: { gemini: config.ai.gemini ? { model: config.ai.gemini.model, apiKey: '***' } : undefined },
    sentryDsn: mask(config.sentryDsn),
  };
}
