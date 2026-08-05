import { createApp } from './app.js';
import { config } from './config/index.js';
import { startScheduler } from './services/scheduler.service.js';
import { pool } from './db/pool.js';
import { captureError, flushSentry } from './instrument.js';

const app = createApp();
let scheduler = null;

const server = app.listen(config.port, () => {
  console.log(`[server] Qarz backend listening on :${config.port} (${config.env})`);
  if (config.env !== 'test') scheduler = startScheduler();
});

// How long to wait for in-flight requests before exiting anyway.
const SHUTDOWN_GRACE_MS = 10_000;
let shuttingDown = false;

const shutdown = (signal) => {
  // A second Ctrl-C, or a SIGTERM racing a SIGINT, must not start a second
  // teardown and double-close the pool.
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[server] ${signal} received, shutting down...`);

  // Stop firing new reminder sweeps while we drain.
  try { scheduler?.stop(); } catch { /* scheduler may never have started */ }

  // Backstop: if a hung keep-alive connection stops `close` from completing,
  // exit anyway rather than waiting forever and being SIGKILLed mid-write by
  // the orchestrator.
  const force = setTimeout(() => {
    console.error('[server] Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);
  force.unref();

  server.close(async (err) => {
    if (err) console.error('[server] Error closing HTTP server:', err);
    // Before the pool, and before exiting: Sentry batches over the network, so
    // the crash report that triggered this shutdown is still only buffered.
    await flushSentry();
    try {
      await pool.end();
    } catch (poolErr) {
      console.error('[server] Error closing DB pool:', poolErr);
    }
    clearTimeout(force);
    process.exit(err ? 1 : 0);
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Without these a stray rejection anywhere — a background fetch to Eskiz or
// Telegram, a cron callback — terminates the process with no indication of
// what failed. Log the cause, then shut down cleanly: the process is in an
// unknown state, so a supervised restart is safer than limping on.
process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled promise rejection:', reason);
  captureError(reason instanceof Error ? reason : new Error(String(reason)), {
    kind: 'unhandledRejection',
  });
  shutdown('unhandledRejection');
});

process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception:', err);
  captureError(err, { kind: 'uncaughtException' });
  shutdown('uncaughtException');
});
