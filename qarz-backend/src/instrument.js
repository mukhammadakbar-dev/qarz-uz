import * as Sentry from '@sentry/node';

/**
 * Error reporting. Loaded via `node --import ./src/instrument.js` so it runs
 * BEFORE any application module — Sentry patches http, express and pg at
 * require time, and anything imported earlier stays uninstrumented.
 *
 * Entirely opt-in: with no SENTRY_DSN this does nothing at all, which is what
 * local development and the test suites want. Never `init()` with an empty DSN
 * just to keep the code path uniform — that still loads the OpenTelemetry
 * instrumentation and its overhead for no benefit.
 */
const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    // Set by the deploy so an incoming error names the version that produced
    // it. Falls back to unset rather than a lie like "unknown".
    release: process.env.SENTRY_RELEASE || undefined,

    // Performance traces are sampled separately from errors and are the
    // expensive part of a Sentry plan. Off by default; turn on at a low rate
    // (0.05–0.1) when actually investigating latency.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),

    // This application handles debts, phone numbers and payment data. Do not
    // let the SDK attach request bodies, headers or cookies to events.
    sendDefaultPii: false,

    beforeSend(event) {
      // Belt and braces: even with sendDefaultPii off, strip anything that
      // could carry a token or a password if an integration adds it later.
      if (event.request) {
        delete event.request.cookies;
        delete event.request.data;
        if (event.request.headers) {
          for (const h of ['authorization', 'x-bot-secret', 'cookie']) {
            delete event.request.headers[h];
          }
        }
      }
      return event;
    },
  });

  console.log('[sentry] Error reporting enabled');
}

/** True when reporting is actually on — lets callers skip building payloads. */
export const sentryEnabled = Boolean(dsn);

/**
 * Report an unexpected error. Safe to call when Sentry is disabled: it becomes
 * a no-op, so call sites need no conditional.
 */
export const captureError = (err, context) => {
  if (!dsn) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
};

/**
 * Flush buffered events before the process exits. Sentry batches over the
 * network, so without this a crash report is lost precisely when it matters —
 * on the crash that ends the process.
 */
export const flushSentry = async (timeoutMs = 2000) => {
  if (!dsn) return;
  try {
    await Sentry.flush(timeoutMs);
  } catch {
    // Shutdown is already in progress; a failed flush must not mask the
    // original error or block the exit.
  }
};
