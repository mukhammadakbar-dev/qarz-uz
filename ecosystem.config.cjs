// pm2 process list for a plain VPS (no Docker). See DEPLOY.md, "VPS (pm2)".
//
//   pm2 start ecosystem.config.cjs && pm2 save
//
// Each service reads its own .env from its cwd (dotenv), so fill in
// qarz-backend/.env and qarz-bot/.env. The web app is not a process here:
// nginx serves qarz-web/dist directly (deploy/nginx.pm2.conf.example).
module.exports = {
  apps: [
    {
      name: 'qarz-backend',
      cwd: `${__dirname}/qarz-backend`,
      script: 'src/server.js',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '400M',
    },
    {
      name: 'qarz-bot',
      cwd: `${__dirname}/qarz-bot`,
      script: 'src/index.js',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '300M',
      // The bot refuses to start until the backend answers; back off instead
      // of burning through restarts while the backend is still booting.
      exp_backoff_restart_delay: 1000,
    },
  ],
};
