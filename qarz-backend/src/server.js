import { createApp } from './app.js';
import { config } from './config/index.js';
import { startScheduler } from './services/scheduler.service.js';
import { pool } from './db/pool.js';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`[server] Qarz backend listening on :${config.port} (${config.env})`);
  if (config.env !== 'test') startScheduler();
});

const shutdown = async (signal) => {
  console.log(`\n[server] ${signal} received, shutting down...`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
