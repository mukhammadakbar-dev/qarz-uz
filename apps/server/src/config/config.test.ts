import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, redactConfig } from './index.js';

const valid = {
  DATABASE_URL: 'postgres://app:pw@localhost:5432/nasiya',
  TELEGRAM_BOT_TOKEN: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
  TELEGRAM_WEBHOOK_SECRET: 'webhook_secret_1234567890',
  SESSION_SECRET: 'x'.repeat(32),
};

const prod = {
  ...valid,
  NODE_ENV: 'production',
  PUBLIC_BASE_URL: 'https://nasiya.example.uz/',
};

const issuesOf = (env: Record<string, string>) => {
  try {
    loadConfig(env);
  } catch (e) {
    if (e instanceof ConfigError) return e.issues;
    throw e;
  }
  return [];
};

describe('loadConfig', () => {
  it('minimal dev konfiguratsiyada default qiymatlar bilan yuklanadi', () => {
    const c = loadConfig(valid);
    expect(c.env).toBe('development');
    expect(c.http.port).toBe(3000);
    expect(c.telegram.mode).toBe('polling');
    expect(c.billing.priceUzs).toBe(29000);
    expect(c.billing.trialDays).toBe(14);
    expect(c.ai.gemini).toBeUndefined();
  });

  it('production da webhook rejimi va trailing slash olib tashlanadi', () => {
    const c = loadConfig(prod);
    expect(c.isProduction).toBe(true);
    expect(c.telegram.mode).toBe('webhook');
    expect(c.telegram.publicBaseUrl).toBe('https://nasiya.example.uz');
  });

  it('natija muzlatilgan (o‘zgartirib bo‘lmaydi)', () => {
    const c = loadConfig(valid);
    expect(Object.isFrozen(c)).toBe(true);
    expect(Object.isFrozen(c.telegram)).toBe(true);
  });

  it('majburiy o‘zgaruvchilar yetishmasa hammasini birga ko‘rsatadi', () => {
    const issues = issuesOf({});
    expect(issues.some((i) => i.startsWith('DATABASE_URL'))).toBe(true);
    expect(issues.some((i) => i.startsWith('TELEGRAM_BOT_TOKEN'))).toBe(true);
    expect(issues.some((i) => i.startsWith('TELEGRAM_WEBHOOK_SECRET'))).toBe(true);
    expect(issues.some((i) => i.startsWith('SESSION_SECRET'))).toBe(true);
  });

  it('xato xabarida secret qiymati ko‘rinmaydi', () => {
    const secret = 'qisqa';
    const issues = issuesOf({ ...valid, SESSION_SECRET: secret });
    expect(issues.join('\n')).toContain('SESSION_SECRET');
    expect(issues.join('\n')).not.toContain(secret);
  });

  it('webhook secret belgilari cheklanadi', () => {
    expect(issuesOf({ ...valid, TELEGRAM_WEBHOOK_SECRET: 'bor bo‘shliq 1234567890' })).not.toEqual(
      [],
    );
  });

  it('production da PUBLIC_BASE_URL majburiy va https bo‘lishi shart', () => {
    expect(issuesOf({ ...prod, PUBLIC_BASE_URL: '' }).join()).toContain('PUBLIC_BASE_URL');
    expect(issuesOf({ ...prod, PUBLIC_BASE_URL: 'http://nasiya.example.uz' }).join()).toContain(
      'https',
    );
  });

  it('production da polling rejimi taqiqlangan', () => {
    expect(issuesOf({ ...prod, TELEGRAM_MODE: 'polling' }).join()).toContain('webhook');
  });

  it('Gemini kaliti va modeli faqat birga beriladi', () => {
    expect(issuesOf({ ...valid, GEMINI_API_KEY: 'k' }).join()).toContain('GEMINI_MODEL');
    const c = loadConfig({ ...valid, GEMINI_API_KEY: 'k', GEMINI_MODEL: 'm' });
    expect(c.ai.gemini).toEqual({
      apiKey: 'k',
      model: 'm',
      timeoutMs: 3000,
      dailyLimit: 300,
      mode: 'always',
      thinkingLevel: 'MINIMAL',
    });
  });

  it('bo‘sh qator berilgan ixtiyoriy o‘zgaruvchi "yo‘q" hisoblanadi', () => {
    const c = loadConfig({ ...valid, GEMINI_API_KEY: '', GEMINI_MODEL: ' ', SENTRY_DSN: '' });
    expect(c.ai.gemini).toBeUndefined();
    expect(c.sentryDsn).toBeUndefined();
  });

  it('superadmin ID lari vergul bilan o‘qiladi, noto‘g‘ri qiymat rad etiladi', () => {
    const c = loadConfig({ ...valid, SUPERADMIN_TELEGRAM_IDS: '111, 222 ,' });
    expect(c.billing.superadminTelegramIds).toEqual([111, 222]);
    expect(issuesOf({ ...valid, SUPERADMIN_TELEGRAM_IDS: '111,abc' })).not.toEqual([]);
  });

  it('admin kontakti telefon formatida bo‘lishi shart', () => {
    expect(loadConfig({ ...valid, SUPPORT_PHONE: '+998907900110' }).billing.supportPhone).toBe(
      '+998907900110',
    );
    expect(issuesOf({ ...valid, SUPPORT_PHONE: '907900110' }).join()).toContain('SUPPORT_PHONE');
  });
});

describe('redactConfig', () => {
  it('secretlarni yashiradi', () => {
    const c = loadConfig({ ...valid, GEMINI_API_KEY: 'gemini-key', GEMINI_MODEL: 'm' });
    const text = JSON.stringify(redactConfig(c));
    for (const secret of [
      valid.TELEGRAM_BOT_TOKEN,
      valid.TELEGRAM_WEBHOOK_SECRET,
      valid.SESSION_SECRET,
      valid.DATABASE_URL,
      'gemini-key',
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});
