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
sudo apt install -y docker.io docker-compose-v2 docker-buildx nginx certbot python3-certbot-nginx
sudo usermod -aG docker "$USER"   # keyin qayta login qiling
```

> **Paket nomiga e'tibor bering.** Compose ikki xil nomlanadi va bu tez-tez
> `Unable to locate package` xatosini beradi:
>
> | Manba | Paket |
> |---|---|
> | Ubuntu repo'si (yuqoridagi, oddiyroq yo'l) | `docker-compose-v2` |
> | Docker'ning o'z repo'si (`download.docker.com`) | `docker-compose-plugin` |
>
> Ikkalasi ham `docker compose` buyrug'ini beradi (defissiz — eski
> `docker-compose` emas). Juda yangi Ubuntu relizlarida Docker'ning o'z
> repo'sida hali mos release bo'lmasligi mumkin, shuning uchun Ubuntu
> paketlari ishonchliroq.

Tekshirish:

```bash
docker --version && docker compose version
docker run --rm hello-world    # guruh a'zoligi ishlayaptimi
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
| `SUPPORT_TELEGRAM_USERNAME` | obuna to'lovi uchun admin Telegram username'i (@ siz) |
| `TELEGRAM_GATEWAY_TOKEN`, `ESKIZ_*` | ixtiyoriy — pullik kanallar, pastga qarang |
| `PUBLIC_BASE_URL`, `CORS_ORIGINS` | o'z domeningiz |
| `SUPER_ADMIN_PHONE`, `SUPER_ADMIN_PASSWORD` | parol kamida 12 belgi |

> ### Tasdiqlash kanallari
>
> Saytda yangi do'kon ochish uchun 6 xonali kod kerak. Uchta yo'l bor:
>
> - **🤖 Bot orqali (bepul, qo'shimcha sozlamasiz ishlaydi).** Foydalanuvchi
>   botga raqamini ulashadi, bot unga kodni ko'rsatadi, u saytga kiritadi.
>   Raqam Telegram kontakti bilan tasdiqlanadi. Faqat `TELEGRAM_BOT_TOKEN`
>   kerak, u allaqachon majburiy.
> - **✈️ Telegram Gateway (pullik).** Kod `@VerificationCodes` dan keladi,
>   foydalanuvchi saytdan chiqmaydi. `gateway.telegram.org` da token oling va
>   **balansni to'ldiring** — balans nol bo'lsa `BALANCE_NOT_ENOUGH` qaytadi.
> - **📩 Eskiz.uz SMS (pullik).** `ESKIZ_EMAIL` / `ESKIZ_PASSWORD`.
>
> Ikki pullik kanal sozlanmagan bo'lsa ham sayt ishlaydi — bot kanali qoladi.
>
> `ESKIZ_*` qarzdorlarga **eslatma** yuborish uchun alohida kerak. U bo'sh
> bo'lsa, productionda eslatmalar `failed` deb belgilanadi va SMS krediti
> sarflanmaydi (developmentda esa logga yoziladi).

> `CORS_ORIGINS` bo'sh qolsa — istalgan sayt API'ni foydalanuvchi tokeni bilan
> boshqara oladi. `SUPPORT_TELEGRAM_USERNAME` bo'sh qolsa — "Tariflar" sahifasi
> va botdagi "Obuna" bo'limi tariflarni ko'rsatadi, lekin obunani yangilash
> uchun murojaat qiladigan hech kim bo'lmaydi.

`CLICK_*` **majburiy emas** — onlayn to'lov hozircha yoqilmagan, obunalar qo'lda
faollashtiriladi (6-bo'limga qarang).

## 3. Deploy oldidan tekshiruv ro'yxati

`.env` to'ldirilgach, ishga tushirishdan **oldin**:

```bash
# 1. Hech qanday example qiymat qolmaganini tekshiring
grep -nE '^(JWT_|PAYMENT_LINK_|BOT_SHARED_|DB_PASSWORD|SUPER_ADMIN_PASSWORD)' .env
```

- [ ] `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `PAYMENT_LINK_SECRET` — uchtasi
      **har xil**, har biri `openssl rand -hex 32` bilan yangi yaratilgan
- [ ] `BOT_SHARED_SECRET` — tasodifiy (`openssl rand -hex 24`), **backend va
      botda bir xil**. Bu kalit `/api/bot/sessions` ni ochadi, ya'ni undan
      barcha foydalanuvchilarning tokenlarini o'qish mumkin — taxmin qilinadigan
      qiymat qo'ymang. Backend uzunligini tekshiradi, taxmin qilinishini emas.
- [ ] `SUPER_ADMIN_PASSWORD` — kamida 12 belgi (seed skripti qisqasini rad etadi)
- [ ] `CORS_ORIGINS` — to'ldirilgan (bo'sh qolsa istalgan sayt API'ga kira oladi)
- [ ] `PUBLIC_BASE_URL` — haqiqiy `https://` domen
- [ ] `TRUST_PROXY` — sxemangizga mos (host nginx + web konteyner = `2`)
- [ ] Tasdiqlash: bot kanali sozlamasiz ishlaydi. Pullik kanallarni
      xohlasangiz — `TELEGRAM_GATEWAY_TOKEN` (balansi to'ldirilgan) yoki `ESKIZ_*`
- [ ] `SUPPORT_TELEGRAM_USERNAME` — obuna to'lovi shu odamga boradi

Ishga tushirgandan **keyin**:

- [ ] `curl localhost:8080/health/ready` → `200`
- [ ] `docker compose logs bot` → `@<bot> running ✔`
- [ ] Super admin bilan saytga kirish
- [ ] Yangi raqam bilan ro'yxatdan o'tib ko'rish (kod kelishini tekshirish)
- [ ] Botda `/start` → kontakt ulash → menyu chiqishi

## 4. Ishga tushirish

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

## 5. TLS

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/qarz
sudo sed -i 's/example\.com/SIZNING-DOMEN.uz/g' /etc/nginx/sites-available/qarz
sudo ln -s /etc/nginx/sites-available/qarz /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d SIZNING-DOMEN.uz -d www.SIZNING-DOMEN.uz
```

`TRUST_PROXY` proxy sonini bildiradi va **rate limit shunga bog'liq**:

- `2` — host nginx + web konteyner (yuqoridagi sxema, standart)
- `1` — faqat web konteyner (TLS ni bulut load balancer uzsa)

Noto'g'ri past qiymat — hamma foydalanuvchi bitta limit chelagini bo'lishadi;
noto'g'ri baland qiymat — mijoz o'z IP sini soxtalashtirib limitdan o'tadi.

## 5b. Telegram Mini App

Veb-ilovaning o'zi Telegram bot ichida "Mini-ilova" sifatida ham ochiladi —
foydalanuvchi botni tark etmasdan, parolsiz kiradi (agar Telegramini botga
avval ulagan bo'lsa). Bu **qo'shimcha** kirish yo'li — telefon+parol orqali
kirish o'zgarishsiz qoladi va Telegram akkaunt yo'qolganda yagona najot bo'lib
qoladi.

Yoqish uchun ikkita qadam:

1. `.env` da bot uchun **`WEB_APP_URL`** ni saytning haqiqiy `https://` manziliga
   o'rnating (`PUBLIC_BASE_URL` bilan bir xil bo'lishi mumkin). **Telegram
   `http://` manzilni butunlay rad etadi** — bo'sh qoldirilsa "📲 Mini-ilova"
   tugmasi botda shunchaki ko'rinmaydi, xato chiqmaydi.
2. Boshqa hech narsa kerak emas — autentifikatsiya `TELEGRAM_BOT_TOKEN` orqali
   ishlaydi, u allaqachon majburiy.

**Muhim cheklov:** Mini-ilova faqat botda **avval ulangan** (kontakt ulashgan)
Telegram akkauntlarga ishlaydi. Birinchi marta ochgan odam — hisobi yo'q odam
emas, balki "hali botda `/start` bosmagan" odam — "Botda /start yuboring" degan
xabar ko'radi. Bu ataylab shunday: Mini-ilova ochilishi faqat Telegram
foydalanuvchi ID'sini beradi, telefon raqamini emas, shuning uchun yangi
ro'yxatdan o'tish hamon botning o'zida (kontakt ulashish orqali) bo'ladi.

## 6. Obuna to'lovi (qo'lda)

Onlayn to'lov keyinroqqa qoldirilgan, shuning uchun obunalar admin orqali
faollashtiriladi:

1. Do'kon egasi "Tariflar" sahifasidan yoki botdagi "💳 Obuna" bo'limidan
   `SUPPORT_TELEGRAM_USERNAME` ga tayyor xabar bilan yozadi (xabarda uning
   telefon raqami bo'ladi — admin do'konni shu bo'yicha topadi).
2. Admin to'lovni qabul qiladi.
3. Admin Super Admin panelidagi **Do'konlar → Uzaytirish** oynasidan tarif,
   muddat va summani kiritadi. Obuna darhol faollashadi, to'lov
   `subscription_payments` jadvaliga tushadi va daromad hisobotida ko'rinadi.

## 7. Click webhook (yoqilganda)

`CLICK_*` bo'sh ekan — backend to'lov havolasini **umuman yaratmaydi** (503
`PAYMENT_GATEWAY_OFF`), web va bot esa tegishli tugmalarni ko'rsatmaydi. Sababi:
`/pay/:token` — bu JSON qaytaradigan API endpoint, checkout sahifasi yo'q, ya'ni
mijozga berilgan havola hech qanday to'lovni qabul qila olmaydi.

Yoqish uchun: uchala `CLICK_*` qiymatini to'ldiring va Click kabinetida callback
URL sifatida `{PUBLIC_BASE_URL}/webhooks/click/*` ni ro'yxatdan o'tkazing. Imzo
`CLICK_SECRET_KEY` bilan tekshiriladi — kalit noto'g'ri bo'lsa callback'lar rad
etiladi (jim qabul qilinmaydi).

Eslatma shablonidagi `{link}` ham shundan keyingina ma'noga ega bo'ladi:
migratsiya 007 uni standart shablonlardan olib tashlagan, xohlasangiz Click
yoqilgach qo'lda qaytarasiz.

## 8. Zaxira nusxa

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

## 9. Xatolik monitoringi (Sentry)

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

## 10. CI/CD va Avtomatik Yangilash

### A) Avtomatlashtirilgan CI/CD (GitHub Actions)
Loyiha repozitoriyasiga `.github/workflows/deploy.yml` joylashtirilgan. `main` tarmog'iga har bir `push` bo'lganda:
1. `backend`, `bot` va `web` testlari hamda linter'lari parallel ravishda yurgiziladi.
2. Ishlab turgan serverga SSH orqali ulanib, yangi kodni tortadi, konteynerlarni qayta quradi va bazani avtomatik migratsiya qiladi.

GitHub Secrets sozlamalari (`Repository Settings -> Secrets and variables -> Actions`):
- `SERVER_HOST`: Server IP manzili yoki domeningiz (masalan: `194.26.x.x`).
- `SERVER_USER`: Server SSH foydalanuvchisi (masalan: `root` yoki `ubuntu`).
- `SSH_PRIVATE_KEY`: Serverga ulanuvchi SSH maxfiy kaliti (Private Key).
- `SERVER_PORT`: (Ixtiyoriy) SSH porti (default: `22`).

### B) Qulay va Avtomatik Qo'lda Deploy Script
Serverda yangilanishlarni bitta buyruq bilan berish uchun:

```bash
./deploy/deploy.sh
```

Yoki klassik usulda:

```bash
git pull origin main
docker compose up -d --build
docker compose run --rm backend node src/db/migrate.js
```

Migratsiyalar `schema_migrations` jadvali orqali bir martadan bajariladi, shu sababli har deployda qayta ishga tushirish xavfsiz.

---

## Bilib qo'yish kerak bo'lgan cheklovlar

- **Bot bitta instansda ishlaydi.** Long polling ikki jarayonni ko'tarmaydi
  (ikkisi bir update uchun kurashadi), va sessiya keshi jarayon ichida turadi.
  `docker compose up --scale bot=2` qilmang.
- **Backendni ko'paytirish mumkin**, lekin rate limit hisoblagichi har bir
  jarayonning xotirasida — 3 ta instans amalda limitni 3 barobar oshiradi.
  Umumiy hisoblagich kerak bo'lsa `rate-limit-redis` ga o'tish kerak.
- **Cron bir nechta instansda xavfsiz.** Kunlik sweep Postgres advisory lock
  (`pg_try_advisory_lock`) oladi, shuning uchun ikkita backend ko'tarsangiz ham
  eslatmalar bir marta yuboriladi — qulfni ololmagan instans o'z tikini
  o'tkazib yuboradi.
- **Frontendda xatolik monitoringi yo'q.** Backend va bot Sentry'ga ulangan
  (pastga qarang), lekin brauzerdagi xatoliklar faqat `ErrorBoundary` bilan
  ushlanadi va hech qayerga yuborilmaydi.
