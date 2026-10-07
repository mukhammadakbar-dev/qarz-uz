import { ALLOWED_UPDATES } from './bot.js';
import { Api } from 'grammy';
import { loadConfig } from '../config/index.js';
import { WEBHOOK_PATH } from '../http/server.js';

// Foydalanish: pnpm --filter @nasiya/server webhook:set | webhook:delete | webhook:info
const config = loadConfig(process.env);
const api = new Api(config.telegram.botToken);
const command = process.argv[2] ?? 'info';
const out = (value: unknown) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

if (command === 'set') {
  if (!config.telegram.publicBaseUrl) throw new Error('PUBLIC_BASE_URL berilmagan');
  await api.setWebhook(`${config.telegram.publicBaseUrl}${WEBHOOK_PATH}`, {
    secret_token: config.telegram.webhookSecret,
    allowed_updates: [...ALLOWED_UPDATES],
    max_connections: 20,
  });
} else if (command === 'delete') {
  await api.deleteWebhook();
}
// Secret token Telegram javobida qaytmaydi; URL va xatolarni ko'rsatadi
out(await api.getWebhookInfo());
