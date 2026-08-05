# Productionga chiqarish

Uch servis (`qarz-backend`, `qarz-bot`, `qarz-web`) + PostgreSQL — hammasi
`docker-compose.yml` orqali ko'tariladi.

```
Internet → host nginx (TLS, 443)
             → web konteyner (nginx :8080) — SPA + /api proxy
                  → backend (:4000) → postgres
             bot (long polling, port ochmaydi) → backend
```

---

## 1. Serverni tayyorlash

Kerak: Docker Engine + Compose plugin, nginx, certbot, ochiq 80/443 portlar va
domen A-yozuvi serverga qaratilgan bo'lishi.

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin nginx certbot python3-certbot-nginx
sudo usermod -aG docker "$USER"   # keyin qayta login qiling
```

## 2. Sozlamalar

```bash
git clone <repo> /srv/qarz && cd /srv/qarz
cp .env.production.example .env
```

`.env` ni to'ldiring. **Majburiy** qiymatlar (ularsiz backend ishga tushmaydi
yoki funksiya jim turib ishlamaydi):

| O'zgaruvchi | Olish yo'li |
|---|---|
| `DB_PASSWORD` | `openssl rand -base64 24` |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `PAYMENT_LINK_SECRET` | har biri alohida: `openssl rand -hex 32` |
| `BOT_SHARED_SECRET` | `openssl rand -hex 24` — backend va bot uchun **bir xil** |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` | @BotFather |
| `CLICK_SERVICE_ID`, `CLICK_MERCHANT_ID`, `CLICK_SECRET_KEY` | Click merchant kabinet |
| `ESKIZ_EMAIL`, `ESKIZ_PASSWORD` | Eskiz.uz kabinet |
| `PUBLIC_BASE_URL`, `CORS_ORIGINS` | o'z domeningiz |
| `SUPER_ADMIN_PHONE`, `SUPER_ADMIN_PASSWORD` | parol kamida 12 belgi |

> `CORS_ORIGINS` bo'sh qolsa — istalgan sayt API'ni foydalanuvchi tokeni bilan
> boshqara oladi. `ESKIZ_*` bo'sh qolsa — SMS **yuborilmaydi**, backend faqat
> logga yozib "muvaffaqiyatli" deb qaytaradi.

## 3. Ishga tushirish

```bash
docker compose up -d --build
docker compose run --rm backend node src/db/migrate.js   # jadvallar
docker compose run --rm backend node src/db/seed.js      # tariflar + super admin
docker compose ps
```

Tekshiruv:

```bash
curl localhost:8080/health          # {"ok":true,...}   — process tirikmi
curl -i localhost:8080/health/ready # 200 = DB ham tayyor, 503 = DB yo'q
docker compose logs -f bot          # "@<bot> running ✔" va hydrated N session(s)
```

## 4. TLS

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/qarz
sudo sed -i 's/temirdaftar\.uz/SIZNING-DOMEN.uz/g' /etc/nginx/sites-available/qarz
sudo ln -s /etc/nginx/sites-available/qarz /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d SIZNING-DOMEN.uz -d www.SIZNING-DOMEN.uz
```

`TRUST_PROXY` proxy sonini bildiradi va **rate limit shunga bog'liq**:

- `2` — host nginx + web konteyner (yuqoridagi sxema, standart)
- `1` — faqat web konteyner (TLS ni bulut load balancer uzsa)

Noto'g'ri past qiymat — hamma foydalanuvchi bitta limit chelagini bo'lishadi;
noto'g'ri baland qiymat — mijoz o'z IP sini soxtalashtirib limitdan o'tadi.

## 5. Click webhook

Click kabinetida callback URL sifatida `{PUBLIC_BASE_URL}/webhooks/click/*`
ni ro'yxatdan o'tkazing. Imzo `CLICK_SECRET_KEY` bilan tekshiriladi — kalit
noto'g'ri bo'lsa callback'lar rad etiladi (jim qabul qilinmaydi).

## 6. Zaxira nusxa

```bash
crontab -e
15 3 * * * /srv/qarz/deploy/backup.sh >> /var/log/qarz-backup.log 2>&1
```

Dump'lar `backups/` ga tushadi, 14 kun saqlanadi. **Ular o'sha diskda yotadi** —
disk ishdan chiqsa ikkalasi ham yo'qoladi. rclone/scp bilan boshqa joyga
ko'chiring.

Tiklashni yiliga bir marta sinab ko'ring — sinalmagan zaxira bu taxmin:

```bash
gunzip -c backups/qarz-YYYY-MM-DD-HHMM.sql.gz | docker compose exec -T db psql -U qarz -d qarz
```

## 7. Xatolik monitoringi (Sentry)

Ixtiyoriy, lekin birinchi haqiqiy foydalanuvchilardan oldin yoqishni tavsiya
qilaman — aks holda productiondagi xatoliklarni faqat log'ni ochib ko'rgandagina
bilasiz.

1. [sentry.io](https://sentry.io) da loyiha oching (Node.js), DSN ni oling.
2. `.env` ga qo'ying: `SENTRY_DSN=https://...`
3. `docker compose up -d` — backend va bot avtomatik ulanadi.

`SENTRY_DSN` bo'sh bo'lsa monitoring **butunlay o'chiq**: `init()` ham
chaqirilmaydi, hech qanday qo'shimcha yuk yo'q.

Nima yuboriladi:

| Manba | Qachon |
|---|---|
| Backend `errorHandler` | Faqat kutilmagan `500` xatoliklar. `AppError` va Postgres'ning mijoz xatolari (`400`/`409`/`422`) **yuborilmaydi** — ular haqiqiy nosozliklarni ko'mib tashlardi |
| Backend `server.js` | `uncaughtException`, `unhandledRejection` |
| Bot `bot.catch` | Update'ni qayta ishlashdagi har qanday xatolik |

Nima **yuborilmaydi:** `sendDefaultPii: false` va `beforeSend` orqali so'rov
tanasi, cookie'lar, `Authorization` va `x-bot-secret` header'lari tozalanadi.
Botdan faqat telegram id va update turi ketadi, xabar matni emas — update'lar
telefon raqami va qarz summalarini olib yuradi.

`SENTRY_TRACES_SAMPLE_RATE` standart `0` (performans trace'lari o'chiq) —
ular alohida hisoblanadi va tarifning qimmat qismi.

## 8. Yangilash

```bash
git pull
docker compose up -d --build
docker compose run --rm backend node src/db/migrate.js   # yangi migratsiyalar bo'lsa
```

Migratsiyalar `schema_migrations` jadvali orqali bir martadan bajariladi, shu
sababli har deployda qayta ishga tushirish xavfsiz.

> `VITE_API_BASE_URL` bundlega **build vaqtida** kiritiladi, shu sababli uni
> o'zgartirsangiz `docker compose build web` kerak — restart yetmaydi.

---

## Bilib qo'yish kerak bo'lgan cheklovlar

- **Bot bitta instansda ishlaydi.** Long polling ikki jarayonni ko'tarmaydi
  (ikkisi bir update uchun kurashadi), va sessiya keshi jarayon ichida turadi.
  `docker compose up --scale bot=2` qilmang.
- **Backendni ko'paytirish mumkin**, lekin rate limit hisoblagichi har bir
  jarayonning xotirasida — 3 ta instans amalda limitni 3 barobar oshiradi.
  Umumiy hisoblagich kerak bo'lsa `rate-limit-redis` ga o'tish kerak.
- **Cron (eslatmalar) har bir backend instansida ishlaydi.** Bir nechta instans
  ko'tarsangiz eslatmalar takrorlanadi — scheduler'ni alohida ajratish kerak.
- **Frontendda xatolik monitoringi yo'q.** Backend va bot Sentry'ga ulangan
  (pastga qarang), lekin brauzerdagi xatoliklar faqat `ErrorBoundary` bilan
  ushlanadi va hech qayerga yuborilmaydi.
