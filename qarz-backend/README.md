# Qarzlarni boshqarish tizimi — Backend API

Node.js + Express + PostgreSQL backend for the debt-management SaaS (TZ asosida). Multi-tenant, JWT + rollarga asoslangan, Click to'lov, Eskiz.uz SMS, Telegram fallback va avtomatik eslatma bilan.

## Texnologiyalar
- **Runtime:** Node.js 18+ (ESM)
- **Framework:** Express
- **DB:** PostgreSQL (`pg`)
- **Auth:** JWT (access + refresh), bcrypt
- **Scheduler:** node-cron (kunlik eslatma)
- **To'lov:** Click Checkout + webhook (imzo tekshiruvi)
- **SMS:** Eskiz.uz
- **Bildirishnoma:** Telegram → SMS fallback

## O'rnatish

```bash
npm install
cp .env.example .env      # qiymatlarni to'ldiring
# PostgreSQL bazasini yarating: createdb qarz
npm run migrate           # jadvallarni yaratadi
npm run seed              # tariflar + super admin
npm start                 # yoki: npm run dev
```

Seed'dan keyin super admin: `+998900000000 / admin12345` (env orqali o'zgartiring: `SUPER_ADMIN_PHONE`, `SUPER_ADMIN_PASSWORD`).

## Rollar
- `super_admin` — platforma egasi (alohida `/api/admin` panel)
- `shop_owner` — do'kon egasi (pullik obuna, 14 kun trial)
- `staff` — do'kon xodimi (tarifga bog'liq)
- `personal` — oddiy foydalanuvchi (bepul, shaxsiy qarz daftari)

## Asosiy endpointlar

### Auth (`/api/auth`)
| Metod | Yo'l | Tavsif |
|---|---|---|
| POST | `/register/shop` | Do'kon egasi ro'yxatdan o'tishi (shop + trial + SMS balans) |
| POST | `/register/personal` | Oddiy foydalanuvchi |
| POST | `/login` | Telefon + parol |
| POST | `/telegram/link` | Telegram akkauntni telefon orqali bog'lash |
| POST | `/refresh` | Access tokenni yangilash |

### Do'kon egasi / oddiy foydalanuvchi (`/api`, Bearer token)
| Metod | Yo'l | Tavsif |
|---|---|---|
| POST | `/debtors` | Qarzdor qo'shish |
| GET | `/debtors?search=&filter=with_debt` | Ro'yxat + qidiruv/filtr |
| GET | `/debtors/:id` | Bitta qarzdor |
| GET | `/debtors/:debtorId/debts` | Qarz tarixi |
| POST | `/debts` | Qarz yozish (`given`/`taken`) |
| POST | `/debts/:id/payments` | Qisman/to'liq to'lov qayd etish |
| POST | `/debts/:id/payment-link` | Bir martalik to'lov linki generatsiya |

### Do'kon statistikasi (`/api/shop`)
| Metod | Yo'l | Tavsif |
|---|---|---|
| POST | `/daily-sales` | Kunlik naqd/karta savdo kiritish |
| GET | `/daily-sales?from=&to=` | Savdo dinamikasi (grafik uchun) |
| GET | `/dashboard` | Umumiy qarz, muddati o'tganlar, oylik aylanma, SMS |

### Super Admin (`/api/admin`, super_admin)
| Metod | Yo'l | Tavsif |
|---|---|---|
| GET | `/shops?search=&plan=&status=` | Barcha do'konlar |
| GET | `/stats` | Platforma statistikasi (shu oygi tushum, faol obunalar, SMS) |
| GET | `/plans` / PATCH `/plans/:code` | Tariflarni sozlash |
| PATCH | `/shops/:shopId/active` | Bloklash/faollashtirish (login) |
| PATCH | `/shops/:shopId/subscription` | Obunani qo'lda uzaytirish + to'lovni qayd etish |
| GET | `/shops/:shopId/subscription-payments` | Do'konning to'lov tarixi |
| GET | `/audit-log` | Faoliyat jurnali |

#### Obunani qo'lda uzaytirish

Click integratsiyasi qo'shilgunicha obunalar shu yo'l bilan faollashtiriladi: do'kon egasi adminga yozadi, to'laydi, admin muddatni uzaytiradi.

```bash
curl -X PATCH http://localhost:4000/api/admin/shops/$SHOP_ID/subscription \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"plan":"pro","months":3,"amountUzs":450000,"note":"Naqd, do'\''konda"}'
# -> {"ok":true,"shopName":"...","plan":"pro","endsAt":"...","payment":{...}}
```

- **`plan` ixtiyoriy** — berilmasa joriy tarif saqlanadi, ya'ni oddiy uzaytirish tarifni tasodifan o'zgartirib yubormaydi.
- **Muddat mavjud tugash sanasidan uzayadi**, agar u hali kelmagan bo'lsa. Erta to'lagan do'kon allaqachon sotib olgan kunlarini yo'qotmaydi. Muddati o'tib ketgan do'kon esa bugundan boshlanadi — o'tgan bo'shliq uchun hisoblanmaydi.
- **`amountUzs: 0` ruxsat etilgan** — bepul uzaytirish ham qayd etilishi kerak bo'lgan hodisa.
- **Tarif o'zgarsa `sms_balance` ham yangilanadi**: `monthly_limit` yangi tarifga o'tadi va oshgan bo'lsa `remaining` darhol farqqa to'ldiriladi. Pasaytirishda allaqachon berilgan SMS qaytarib olinmaydi.
- Hammasi bitta tranzaksiyada, qator `FOR UPDATE` bilan qulflanadi — ikki admin bir vaqtda uzaytirsa bitta muddat ikki to'lovga berilib ketmaydi.
- `audit_logs` ga `extend_subscription` yozuvi tushadi.

`PATCH /shops/:shopId/active` dan farqi: u `users.is_active` ni o'zgartiradi (moderatsiya — suiiste'mol qilgan do'konni bloklash). To'lagan do'kon ham bloklangan bo'lishi mumkin, bloklangan do'konning obunasi ham uzaytirilishi mumkin. Ularni birlashtirsak, blokdan chiqarish jimgina bepul vaqt berib yuborardi.

To'lovlar `subscription_payments` jadvalida (`method='manual'`). Click qo'shilganda uning callback'lari shu jadvalga `method='click'` bilan tushadi va tarix uzilmaydi. Tekshirildi: `tests/subscription_extend_test.mjs` (48 ta).

### Ommaviy to'lov (auth yo'q)
| Metod | Yo'l | Tavsif |
|---|---|---|
| GET | `/pay/:token` | To'lov linki ma'lumoti |
| POST | `/webhooks/click/prepare` | Click Prepare (imzo tekshiriladi) |
| POST | `/webhooks/click/complete` | Click Complete → qarz avtomatik yangilanadi |

### Telegram bot sessiyalari (`/api/bot`, `x-bot-secret` header)
Bot foydalanuvchilarining tokenlarini saqlaydigan do'kon. Foydalanuvchi tokeni bilan **emas**, `BOT_SHARED_SECRET` bilan himoyalangan — chunki bot barcha foydalanuvchilar bo'ylab ishlaydi. Shu sababli bu kalit yuqori qiymatga ega: uni brauzer klientiga bermang.

| Metod | Yo'l | Tavsif |
|---|---|---|
| GET | `/sessions` | Hamma sessiya (bot ishga tushganda keshni to'ldiradi) |
| PUT | `/sessions/:telegramId` | Sessiyani yozish/almashtirish (maks. 8KB) |
| DELETE | `/sessions/:telegramId` | Sessiyani o'chirish (logout) |

Tekshirildi: `tests/bot_sessions_test.mjs` (21 ta).

### Health
| Metod | Yo'l | Tavsif |
|---|---|---|
| GET | `/health` | Liveness — jarayon tirikmi. DB'ga **tegmaydi**: qayta ishga tushirish o'lgan Postgres'ni tuzatmaydi, shuning uchun orkestrator konteynerni o'ldirmasligi kerak |
| GET | `/health/ready` | Readiness — DB javob beradimi. Bermasa `503`, load balancer trafikni to'xtatadi |

## Muhim biznes-mantiq

**Kunlik aylanma** = qo'lda kiritilgan naqd/karta + o'sha kuni yozilgan `given` qarzlar (avtomatik `daily_sales`ga qo'shiladi).

**Kanal tanlash:** qarzdorda `telegram_id` bo'lsa → Telegram, aks holda → SMS. SMS yuborilganda do'konning balansi kamayadi (avval bepul limit, keyin qo'shimcha paket).

**To'lov linki:** noyob HMAC token, bir martalik, muddatli (default 48 soat). Click webhook imzo bilan tekshiriladi.

**Eslatma:** har kuni 09:00 (Asia/Tashkent) cron muddati yaqin/o'tgan qarzlarni tekshiradi, bir kunda bir marta yuboradi, muddati o'tganlarni `overdue` deb belgilaydi.

## Keyingi bosqichlar (TZ 8-bo'lim)
Payme integratsiyasi, ko'p filial, mobil ilova, referal tizimi — 2-versiyaga qoldirilgan.

---

# Xavfsizlik tuzatishlari (code review bo'yicha)

## Testlar
```bash
node tests/otp_test.mjs        # OTP xavfsizligi (8 ta)
node tests/click_test.mjs      # Click retry/idempotentlik (11 ta)
node tests/logic_test.mjs      # Obuna + tarif limitlari (16 ta)
node tests/http_test.mjs       # Haqiqiy HTTP endpointlar (8 ta)
node tests/rem_test.mjs        # Scheduler (7 ta)
node tests/reminder_test.mjs   # Eslatma oralig'i (8 ta)
node tests/plan_test.mjs       # Dinamik tarif yangilash (7 ta)
```

## 1. Telegram bog'lash — ikki bosqichli OTP

Eski `POST /api/auth/telegram/link` **410 Gone** qaytaradi (akkaunt o'g'irlash zaifligi).

```bash
# 1-bosqich: SMS orqali kod so'rash
curl -X POST http://localhost:4000/api/auth/telegram/request-link \
  -H 'Content-Type: application/json' \
  -d '{"phone":"901234567"}'
# -> {"sent":true}   (noma'lum raqam uchun ham — enumeratsiyaga qarshi)

# 2-bosqich: kod bilan tasdiqlash
curl -X POST http://localhost:4000/api/auth/telegram/confirm-link \
  -H 'Content-Type: application/json' \
  -d '{"phone":"901234567","telegramId":123456789,"otp":"482913"}'
# -> {"linked":true,"user":{...},"tokens":{...}}
```
Kod: 6 xonali, 5 daqiqa, HMAC-SHA256 bilan xeshlangan, 5 urinishdan keyin blok, bir marta ishlatiladi. Rate-limit: IP+telefon bo'yicha soatiga 5 ta so'rov / 10 ta tasdiqlash.

## 2. Obuna muddati
Muddati tugagan do'kon uchun yozish (POST/PATCH/PUT/DELETE) → `403 SUBSCRIPTION_EXPIRED`. O'qish (GET) ishlaydi — "ko'rish rejimi".

## 3. Tarif limitlari
Limit to'lganda → `422 PLAN_LIMIT_REACHED`. `max_debtors: null` = cheksiz.

## 4. Xodimlar
```bash
curl -X POST http://localhost:4000/api/shop/staff \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"phone":"935556677","password":"parol123","fullName":"Aziz"}'

curl http://localhost:4000/api/shop/staff -H "Authorization: Bearer $TOKEN"
curl -X PATCH http://localhost:4000/api/shop/staff/$ID/active \
  -H "Authorization: Bearer $TOKEN" -d '{"active":false}'
curl -X DELETE http://localhost:4000/api/shop/staff/$ID -H "Authorization: Bearer $TOKEN"
```

## 5. Click qayta so'rovi
Takroriy Complete → `-4 ALREADY_PAID` (avval `-6` edi), ikki marta hisoblanmaydi. Summa mos kelmasa `-2`, muddati o'tgan link `-6`.

## 6. Eslatmalar
`repeat_count` va yangi `repeat_interval_days` (default 3) hurmat qilinadi. 30 kunlik sinov: 30 ta o'rniga **2 ta** eslatma.

## 9-12
- Tarif yangilash: dinamik SQL — `null`/`0`/`false` to'g'ri saqlanadi
- Do'kon bloklanganda xodimlar ham bloklanadi
- Production: zaif/placeholder/qisqa maxfiy kalitlar bilan server **ishga tushmaydi**
- Qarzdorda telefon yoki Telegram ID dan kamida bittasi majburiy

## Migratsiya
```bash
npm run migrate   # schema.sql + migrations/*.sql (idempotent)
```
`002_otp_and_reminders.sql` faqat qo'shimcha (additive) — mavjud ma'lumot buzilmaydi.

---

# Qo'shimcha: ro'yxatdan o'tish OTP, mijoz CRUD, obuna holati

## 0. Ro'yxatdan o'tishda telefon tasdiqlash

```bash
# 1-bosqich: kod so'rash
curl -X POST http://localhost:4000/api/auth/register/request-otp \
  -H 'Content-Type: application/json' -d '{"phone":"901234567"}'
# -> {"sent":true}   yoki   409 PHONE_TAKEN agar raqam band bo'lsa

# 2-bosqich: kod bilan do'kon ochish
curl -X POST http://localhost:4000/api/auth/register/shop \
  -H 'Content-Type: application/json' \
  -d '{"phone":"901234567","password":"parol123","shopName":"Test","otp":"482913"}'
```
Telegram bot `x-bot-secret` header orqali (`.env`dagi `BOT_SHARED_SECRET`) bu OTP'ni chetlab o'tadi — chunki kontakt ulashish allaqachon tasdiq hisoblanadi. Bu imtiyoz **faqat server tomonidagi maxfiy kalit** orqali beriladi, so'rov tanasidagi (`body`) hech qanday maydon orqali emas.

## 3. Mijozni tahrirlash / arxivlash
```bash
curl -X PATCH http://localhost:4000/api/debtors/$ID \
  -H "Authorization: Bearer $TOKEN" -d '{"fullName":"Yangi Ism"}'

curl -X DELETE http://localhost:4000/api/debtors/$ID -H "Authorization: Bearer $TOKEN"
# -> 409 HAS_OPEN_DEBTS agar to'lanmagan qarz bo'lsa
```
O'chirish emas — **arxivlash** (`is_archived`), tarix saqlanadi.

## 8. Dashboard'da obuna holati
`GET /api/shop/dashboard` javobiga qo'shildi:
```json
"subscription": { "status": "trial", "daysLeft": 3, "isTrial": true, "canWrite": true }
```

## Testlar
```bash
node tests/register_otp_test.mjs   # ro'yxatdan o'tish OTP + validatsiya (22 ta)
```
Jami: **87 ta test, 0 ta xato** (`for f in tests/*.mjs; do node $f; done`).

## Yangi migratsiya
`003_debtor_archive.sql` — `debtors.is_archived` (additive, backward-compatible).

## ⚠️ Muhim: bot bilan bog'lash uchun BOT_SHARED_SECRET

Telegram bot ro'yxatdan o'tishda SMS-OTP bosqichini o'tkazib yuborishi uchun `.env`da `BOT_SHARED_SECRET` **majburiy** o'rnatilishi kerak, va u `qarz-bot`ning o'z `.env`idagi xuddi shu qiymatga teng bo'lishi shart:

```bash
openssl rand -hex 24   # ikkala .env fayliga ham shu qiymatni qo'ying
```

Agar bu o'rnatilmasa: bot orqali ro'yxatdan o'tish **buziladi** — backend oddiy OTP talab qiladi, lekin bot buni so'ramaydi, natijada foydalanuvchi "Kod topilmadi" xatosini ko'radi. Tekshirilgan: `tests/bot_secret_test.mjs`.

---

# ⚠️ KRITIK TUZATISH — Super Admin panelining 403 xatosi

**Muammo:** `app.js`da `debtRoutes` `/api` prefiksi bilan `/api/shop` va `/api/admin`dan **oldin** mount qilingan edi. Express `app.use()`ni ro'yxatdan o'tish tartibida, prefiks bo'yicha moslashtiradi — shuning uchun `/api/admin/*`ga har qanday so'rov avval `debtRoutes`ning o'z `authorize('shop_owner','staff','personal')` tekshiruvidan o'tishga majbur bo'lardi. Do'kon egalari uchun bu ko'rinmas edi (ular shu ro'yxatda bor, mos marshrut topilmagani uchun keyingi mount'ga o'tib ketardi), lekin **`super_admin` uchun har doim `403` bilan rad etilardi** — `adminRoutes`ga umuman yetib bormasdan.

**Natija:** Super Admin panelining **hamma** backend endpoint'i (`/api/admin/shops`, `/stats`, `/plans`, `/audit-log`, va h.k.) ishlamasdi. Bu www darajasida hech qachon ushlanmagan edi, chunki frontend testlari tarmoqni mock qilgan, real backend'ga tegmagan edi.

**Tuzatish:** `app.js`da mount tartibi o'zgartirildi — aniqroq prefikslar (`/api/shop`, `/api/admin`) umumiy `/api` prefiksidan **oldin** ro'yxatdan o'tkaziladi.

**Tekshirildi:** `tests/route_order_test.mjs` — 9 ta test, jumladan `super_admin`ning barcha `/api/admin/*`ga kirishi va `shop_owner`ning bloklanishi.

## Yangi: Broadcast (xabar yuborish)

TZ 4.6-band, 9-band: "Barcha do'kon egalariga tizim xabarini yuborish". Endi to'liq ishlaydi:

```bash
curl -X POST http://localhost:4000/api/admin/broadcast \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
  -d '{"message":"Ertaga 02:00-04:00 texnik ishlar bo'\''ladi"}'
# -> {"ok":true,"announcementId":"...","totalOwners":12,"telegramSent":9,"failed":1}
```
E'lon avval `announcements` jadvaliga saqlanadi — shuning uchun har bir faol do'kon egasi uni saytda ko'radi, hatto Telegram ulanmagan bo'lsa ham. Telegram esa ustiga qo'shimcha push. SMS yuborilmaydi: u har bir e'lonni pullik qilar va o'qilgach yo'qolar edi. Audit log'ga yoziladi. Tekshirildi: `tests/announcements_test.mjs` (28 ta).

Jami: **383 ta backend test, 0 ta xato** (`npm test`).

---

## Productionga chiqarish

To'liq qo'llanma: [`../DEPLOY.md`](../DEPLOY.md) — Docker Compose, nginx + TLS, zaxira nusxa.

Diqqat qilinadigan sozlamalar:

- `CORS_ORIGINS` — bo'sh qolsa istalgan sayt API'ni foydalanuvchi tokeni bilan boshqara oladi.
- `TRUST_PROXY` — proxy soni. Rate limit `req.ip` ga bog'langan: past qiymat hamma foydalanuvchini bitta chelakka yig'adi, baland qiymat mijozga IP soxtalashtirishga imkon beradi.
- `DB_SSL` — boshqariladigan Postgres (Neon, Supabase, RDS) ochiq ulanishni rad etadi, `true` qiling.
- `JWT_*` va `PAYMENT_LINK_SECRET` — productionda zaif yoki namunaviy qiymat bo'lsa **backend ishga tushmaydi** (`src/config/index.js`).
