import { createHmac } from 'node:crypto';
import { pino, type DestinationStream, type Logger } from 'pino';
import type { Config } from '../config/index.js';
import { getContext } from './context.js';

export type { Logger };

/**
 * Foydalanuvchi matni va secretlar logga tushmasligi uchun redaction yo'llari.
 * Xabar matni o'rniga `describeText` natijasi (uzunlik + HMAC) yoziladi.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-telegram-bot-api-secret-token"]',
  'text',
  '*.text',
  'message',
  'input',
  '*.input',
  'phone',
  '*.phone',
  'initData',
  '*.initData',
  'token',
  '*.token',
  'secret',
  '*.secret',
  'botToken',
  '*.botToken',
  'apiKey',
  '*.apiKey',
  'password',
  '*.password',
  'connectionString',
  '*.connectionString',
  'amount',
  '*.amount',
] as const;

export function createLogger(
  config: Pick<Config, 'logLevel' | 'isProduction' | 'env'>,
  destination?: DestinationStream,
): Logger {
  const options = {
    level: config.logLevel,
    base: { service: 'nasiya-server', env: config.env },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label: string) => ({ level: label }) },
    redact: { paths: [...REDACT_PATHS], censor: '[REDACTED]' },
    mixin: () => getContext() ?? {},
  };
  if (destination) return pino(options, destination);
  if (!config.isProduction && config.env !== 'test') {
    return pino({ ...options, transport: { target: 'pino-pretty', options: { colorize: true } } });
  }
  return pino(options);
}

/**
 * Matn o'rniga logga yoziladigan ko'rinish: uzunlik va kalitli hash (bir xil matnni
 * kuzatish uchun yetarli, lekin mazmunini tiklab bo'lmaydi).
 */
export function describeText(text: string, key: string): { len: number; hash: string } {
  return {
    len: text.length,
    hash: createHmac('sha256', key).update(text).digest('hex').slice(0, 12),
  };
}
