import { createHmac } from 'node:crypto';

const BOT_TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';

/** Telegram hujjatidagi algoritm bo'yicha mustaqil imzolovchi (verifier kodidan nusxa emas). */
export function signInitData(
  fields: Record<string, string>,
  botToken = BOT_TOKEN,
  tamper?: (hash: string) => string,
): string {
  const check = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .toSorted()
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  const params = new URLSearchParams(fields);
  params.set('hash', tamper ? tamper(hash) : hash);
  return params.toString();
}
