import { config } from '../config/index.js';

const api = (method) =>
  `https://api.telegram.org/bot${config.telegram.botToken}/${method}`;

/**
 * Send a Telegram message to a chat (debtor's telegram_id).
 * Returns { ok, error? }. Logs in dev when no token.
 */
export const sendTelegramMessage = async (chatId, text) => {
  if (!config.telegram.botToken) {
    console.log(`[tg:dev] -> ${chatId}: ${text}`);
    return { ok: true, dev: true };
  }
  try {
    const res = await fetch(api('sendMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) return { ok: false, error: data.description || 'Telegram error' };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
};
