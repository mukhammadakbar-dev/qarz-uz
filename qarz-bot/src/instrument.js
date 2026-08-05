import * as Sentry from '@sentry/node';

/**
 * Error reporting for the bot. Mirrors qarz-backend/src/instrument.js — see
 * there for why this is loaded via `node --import` and why an empty DSN skips
 * init() entirely rather than initialising a no-op client.
 */
const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE || undefined,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
    // Telegram updates carry phone numbers, contact cards and debt amounts.
    sendDefaultPii: false,
  });

  console.log('[sentry] Error reporting enabled');
}

export const sentryEnabled = Boolean(dsn);

export const captureError = (err, context) => {
  if (!dsn) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
};

export const flushSentry = async (timeoutMs = 2000) => {
  if (!dsn) return;
  try {
    await Sentry.flush(timeoutMs);
  } catch {
    // Shutdown is already under way; never block the exit on this.
  }
};
