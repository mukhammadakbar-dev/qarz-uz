// PM2 konfiguratsiyasi (ADR-0001): bitta fork jarayon — webhook, API va cron birga.
// Env fayl Node'ning o'zi bilan o'qiladi (--env-file), PM2 env'ga secretlar ko'chmaydi.
const path = require('node:path');

const envFile = process.env.NASIYA_ENV_FILE || '/etc/nasiya/server.env';

module.exports = {
  apps: [
    {
      name: 'nasiya',
      cwd: path.join(__dirname, 'apps/server'),
      script: 'dist/main.js',
      node_args: `--env-file=${envFile}`,
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      min_uptime: '10s',
      max_restarts: 10,
      max_memory_restart: '400M',
      // main.ts: SIGTERM'da webhook'ni yopadi va tranzaksiyalarni tugatadi (15 s gacha)
      kill_timeout: 20000,
      time: true,
      merge_logs: true,
      out_file: '/var/log/nasiya/out.log',
      error_file: '/var/log/nasiya/error.log',
      env: { NODE_ENV: 'production' },
    },
  ],
};
