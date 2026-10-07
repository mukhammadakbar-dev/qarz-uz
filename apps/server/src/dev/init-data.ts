import { createHmac } from 'node:crypto';

/**
 * FAQAT lokal ishlab chiqish uchun: Mini App'ni Telegramsiz brauzerda sinash uchun imzolangan initData yasaydi.
 *   pnpm --filter @nasiya/server dev:initdata 840369610 Akbar
 * Natijani apps/miniapp/.env.local ga VITE_DEV_INIT_DATA=... deb qo'ying (dev rejimidagina o'qiladi).
 * Production'da ishlamaydi.
 */
if (process.env['NODE_ENV'] === 'production') {
  process.stderr.write('production da ishlamaydi\n');
  process.exit(1);
}
const token = process.env['TELEGRAM_BOT_TOKEN'];
if (!token) {
  process.stderr.write('TELEGRAM_BOT_TOKEN kerak (.env)\n');
  process.exit(1);
}
const [idArg, firstName = 'Dev'] = process.argv.slice(2);
const id = Number(idArg);
if (!Number.isSafeInteger(id) || id <= 0) {
  process.stderr.write('Foydalanish: dev:initdata <telegram_id> [ism]\n');
  process.exit(1);
}

const fields: Record<string, string> = {
  auth_date: String(Math.floor(Date.now() / 1000)),
  query_id: 'DEV',
  user: JSON.stringify({ id, first_name: firstName }),
};
const check = Object.entries(fields)
  .map(([k, v]) => `${k}=${v}`)
  .toSorted()
  .join('\n');
const secret = createHmac('sha256', 'WebAppData').update(token).digest();
const params = new URLSearchParams(fields);
params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
process.stdout.write(`${params.toString()}\n`);
