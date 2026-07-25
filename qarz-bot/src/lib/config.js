import dotenv from 'dotenv';
dotenv.config();

export const config = {
  botToken: process.env.TELEGRAM_BOT_TOKEN || '',
  apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:4000',
  defaultLang: process.env.DEFAULT_LANG || 'uz',
  // Must match BOT_SHARED_SECRET on the backend. Lets this bot register users
  // without a second SMS OTP, since sharing a contact already proves ownership.
  botSharedSecret: process.env.BOT_SHARED_SECRET || '',
  // optional: run with webhooks instead of long polling
  useWebhook: process.env.USE_WEBHOOK === 'true',
  webhookUrl: process.env.WEBHOOK_URL || '',
  port: parseInt(process.env.PORT || '3001', 10),
};

if (!config.botToken) {
  console.warn('[config] TELEGRAM_BOT_TOKEN not set — bot will not start.');
}
