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
| GET | `/stats` | Platforma statistikasi (MRR, faol obunalar, SMS) |
| GET | `/plans` / PATCH `/plans/:code` | Tariflarni sozlash |
| PATCH | `/shops/:shopId/active` | Bloklash/faollashtirish |
| GET | `/audit-log` | Faoliyat jurnali |

### Ommaviy to'lov (auth yo'q)
| Metod | Yo'l | Tavsif |
|---|---|---|
| GET | `/pay/:token` | To'lov linki ma'lumoti |
| POST | `/webhooks/click/prepare` | Click Prepare (imzo tekshiriladi) |
| POST | `/webhooks/click/complete` | Click Complete → qarz avtomatik yangilanadi |

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
