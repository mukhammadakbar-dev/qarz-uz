# Deploy (VPS + PM2 + Nginx)

Qarorlar: ADR-0001. Docker productionda ishlatilmaydi. Quyidagi qadamlar Ubuntu 22.04/24.04 uchun.
**Eslatma:** deploy skripti va bootstrap SQL lokal sinovdan o‘tgan (bootstrap + migratsiya + 103 ta integratsion test toza DB ga qarshi), lekin `deploy.sh` va nginx konfiguratsiyasi haqiqiy serverda hali sinalmagan.

## 1. Server tayyorlash (bir marta)

```bash
# root yoki sudo bilan
apt update && apt install -y nginx postgresql postgresql-contrib certbot python3-certbot-nginx git curl ufw
# Node 22 (NodeSource yoki nvm) va pnpm, pm2
npm i -g pm2 && corepack enable          # corepack pnpm'ni packageManager maydonidan oladi

adduser --disabled-password --gecos "" deploy
mkdir -p /srv/nasiya /etc/nasiya /var/log/nasiya
chown deploy: /srv/nasiya /var/log/nasiya
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable
```

PostgreSQL 16 tavsiya etiladi (lokal sinov 16 da o‘tgan). Postgres faqat `localhost` da tinglasin (`listen_addresses = 'localhost'`).

## 2. Ma’lumotlar bazasi

```bash
export NASIYA_MIGRATOR_PW=$(openssl rand -hex 24) NASIYA_APP_PW=$(openssl rand -hex 24) NASIYA_SYSTEM_PW=$(openssl rand -hex 24)
sudo -E -u postgres psql -v ON_ERROR_STOP=1 -f deploy/db/bootstrap.sql
echo "$NASIYA_MIGRATOR_PW $NASIYA_APP_PW $NASIYA_SYSTEM_PW"   # parol menejeriga saqlang, keyin terminaldan tozalang
```

Uchta rol (`nasiya_migrator`, `nasiya_app`, `nasiya_system`) ma’nosi `docs/adr/0006-tenancy-auth-rbac.md` da.

## 3. Konfiguratsiya

`/etc/nasiya/server.env` (`chown deploy:deploy`, `chmod 600`). Namuna: `.env.example`.

```ini
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
DATABASE_URL=postgres://nasiya_app:<APP_PW>@localhost:5432/nasiya
MIGRATOR_DATABASE_URL=postgres://nasiya_migrator:<MIGRATOR_PW>@localhost:5432/nasiya
SYSTEM_DATABASE_URL=postgres://nasiya_system:<SYSTEM_PW>@localhost:5432/nasiya
TELEGRAM_BOT_TOKEN=<BotFather tokeni>
TELEGRAM_WEBHOOK_SECRET=<openssl rand -hex 32>
PUBLIC_BASE_URL=https://<domen>
MINIAPP_URL=https://<domen>/app/
SESSION_SECRET=<openssl rand -hex 32>
SUPERADMIN_TELEGRAM_IDS=840369610
SUPPORT_PHONE=+998907900110
# GEMINI_API_KEY=...
# GEMINI_MODEL=...
```

Gemini ixtiyoriy: `GEMINI_API_KEY` + `GEMINI_MODEL` (+ `GEMINI_TIMEOUT_MS`, `GEMINI_DAILY_LIMIT`, `GEMINI_MODE`). Berilmasa bot faqat rule parser bilan ishlaydi. **Modelni jonli `eval:llm` natijasiga qarab tanlang.** `SYSTEM_DATABASE_URL` retention va reconciliation uchun kerak (bo‘lmasa ogohlantirish chiqadi). `SENTRY_DSN` hardening bosqichida.

## 4. Kod, nginx, TLS

```bash
sudo -u deploy git clone <repo-url> /srv/nasiya
cp /srv/nasiya/deploy/nginx.conf.example /etc/nginx/sites-available/nasiya   # domenni almashtiring
ln -s /etc/nginx/sites-available/nasiya /etc/nginx/sites-enabled/ && nginx -t
certbot --nginx -d <domen>
systemctl reload nginx
```

## 5. Birinchi ishga tushirish

```bash
sudo -u deploy bash -c 'cd /srv/nasiya && deploy/deploy.sh'
sudo -u deploy pm2 startup systemd        # chiqqan buyruqni root sifatida bajaring, so‘ng: pm2 save
cd /srv/nasiya/apps/server && sudo -u deploy node --env-file=/etc/nasiya/server.env dist/webhook-cli.js set
```

`webhook-cli.js set` Telegram webhook’ini `PUBLIC_BASE_URL/telegram/webhook` ga o‘rnatadi (secret token bilan) va `getWebhookInfo` natijasini chiqaradi: `last_error_message` bo‘sh bo‘lishi kerak.

Tekshiruv:

- `curl https://<domen>/healthz` → `{"status":"ok"}`
- Telegram’da `@tdaftar_bot` ga `/start`
- `pm2 logs nasiya`

## 5a. Mini App

Mini App Node jarayonining o‘zi tomonidan `/app/` ostida beriladi (`apps/miniapp/dist`, `deploy.sh` quradi). Alohida statik hosting kerak emas.

- `MINIAPP_URL` (HTTPS majburiy, oxirida `/app/`) berilsa, bot ishga tushganda chat menyusidagi **📱 Ilova** tugmasini o‘rnatadi, `/app` buyrug‘i va mijoz menyusidagi “Ilovani ochish” tugmalari shu manzilni ochadi.
- Tekshiruv: `curl -I https://<domen>/app/` → `200`, `cache-control: no-cache`; Telegram’da botni oching → **📱 Ilova**.
- Mini App faqat Telegram ichida kira oladi (`initData` imzosi tekshiriladi). Brauzerda to‘g‘ridan-to‘g‘ri ochilsa “Telegram ichida oching” deydi.

## 6. Keyingi deploy’lar

`deploy/deploy.sh`: `git reset --hard origin/main` → `pnpm install` → server va Mini App build → migratsiyalar → `pm2 startOrReload` → `/readyz` tekshiruvi. Tekshiruv o‘tmasa avvalgi commitga qaytadi.

Migratsiyalar faqat oldinga ketadi, rollback sxemani qaytarmaydi. Shu sababli har bir migratsiya avvalgi kod versiyasi bilan mos ishlashi kerak (avval ustun qo‘shish, keyin ishlatish, eng oxirida eskisini olib tashlash).

## 7. Hali yo‘q (rejada)

- Kunlik zaxira nusxa va tiklash mashqi (T6.5): **zaxirasiz production’ga real foydalanuvchi qo‘shmang.**
- Monitoring/alert (T6.3), log rotatsiyasi (`pm2 install pm2-logrotate`).
- GitHub Actions orqali avtomatik deploy (server tayyor bo‘lgach).
