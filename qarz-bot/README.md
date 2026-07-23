# Qarzlarni boshqarish tizimi — Telegram bot

Node.js + [grammY](https://grammy.dev) Telegram bot. Backend API bilan ishlaydi (do'kon egasi va oddiy foydalanuvchi uchun tezkor amallar + bildirishnoma kanali). O'zbek va Rus tillari.

## Xususiyatlar (TZ 4.1 / 4.2 / 9.2)
- **Telefon orqali avtomatik kirish** — foydalanuvchi kontaktini ulashadi (`share_contact`), bot uni telefon raqami bo'yicha mavjud akkauntga bog'laydi. Alohida login/parol shart emas.
- **Bir akkaunt** — bot va veb-sayt bitta backend akkauntga bog'lanadi (JWT token bot sessiyasida saqlanadi).
- **Tezkor qarz yozish** — bosqichma-bosqich: ism → telefon → summa → muddat → izoh.
- **Qarzdorlar ro'yxati** — qoldiq bilan, har biriga inline "tarix" va "qarz qo'shish" tugmalari.
- **Dashboard** — umumiy qarz, muddati o'tganlar, oylik aylanma, SMS qoldiq.
- **Kunlik savdo** — naqd/karta summa kiritish (backend o'sha kun qarzlarini avtomatik qo'shadi).
- **Oddiy foydalanuvchi ro'yxati** — `/register` orqali botdan to'g'ridan-to'g'ri bepul akkaunt.
- **Ikki til** — O'zbek / Rus, inline tugma orqali almashtiriladi.

## O'rnatish

```bash
npm install
cp .env.example .env
# .env ichida:
#   TELEGRAM_BOT_TOKEN — @BotFather dan
#   API_BASE_URL — backend manzili (masalan http://localhost:4000)
npm start          # long polling; yoki: npm run dev
```

Backend ishga tushgan bo'lishi kerak (qarang: qarz-backend README).

## Buyruqlar
| Buyruq | Tavsif |
|---|---|
| `/start` | Botni ishga tushirish, kontakt so'rash |
| `/menu` | Asosiy menyu |
| `/register` | Oddiy foydalanuvchi sifatida ro'yxatdan o'tish |
| `/cancel` | Joriy amalni bekor qilish |

## Arxitektura
```
src/
├─ index.js              # bot yig'ilishi, routing, xatolarni ushlash
├─ lib/
│  ├─ config.js          # env
│  ├─ api.js             # backend API klienti (fetch)
│  ├─ sessions.js        # token/til saqlash (fayl asosida — prod'da Redis)
│  └─ i18n.js            # uz/ru tarjima + money formatlash
├─ locales/{uz,ru}.js    # matnlar
├─ keyboards/index.js    # menyu, kontakt, til klaviaturalari
├─ handlers/
│  ├─ auth.js            # /start + kontakt (telefon orqali kirish)
│  └─ menu.js            # ro'yxat, dashboard, til, callback'lar
└─ scenes/               # grammY conversations (ko'p bosqichli oqimlar)
   ├─ addDebt.js
   ├─ dailySales.js
   └─ register.js
```

## Ishlash oqimi (kirish)
1. Foydalanuvchi `/start` → bot kontakt so'raydi.
2. Kontakt ulashadi → bot `POST /api/auth/telegram/link` chaqiradi.
3. Telefon mavjud akkauntga mos kelsa → bog'lanadi, token olinadi, rolga qarab menyu ko'rsatiladi.
4. Mos kelmasa → telefon eslab qolinadi, `/register` orqali bepul akkaunt yaratish taklif qilinadi.

## Eslatma
- Sessiyalar hozircha `.sessions.json` faylida saqlanadi (soddalik uchun). Ishlab chiqarishda Redis yoki backend DB'ga ko'chirish tavsiya etiladi.
- Webhook rejimi qo'llab-quvvatlanadi: `.env` da `USE_WEBHOOK=true` va `WEBHOOK_URL` ni bering.
- Bildirishnoma yuborish (eslatma) backend cron'i tomonidan Telegram Bot API orqali amalga oshiriladi — bot bu xabarlarni qabul qiluvchi kanal.
