import dotenv from 'dotenv';
dotenv.config();

export const config = {
  botToken: process.env.TELEGRAM_BOT_TOKEN || '',
  apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:4000',
  defaultLang: process.env.DEFAULT_LANG || 'uz',
  // optional: run with webhooks instead of long polling
  useWebhook: process.env.USE_WEBHOOK === 'true',
  webhookUrl: process.env.WEBHOOK_URL || '',
  port: parseInt(process.env.PORT || '3001', 10),
};

if (!config.botToken) {
  console.warn('[config] TELEGRAM_BOT_TOKEN not set — bot will not start.');
}
