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
│  ├─ sessions.js        # token/til saqlash (backend DB + xotira keshi)
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
- Sessiyalar backend DB'sida saqlanadi (`bot_sessions` jadvali), `/api/bot/sessions` endpoint'lari orqali. Bot ishga tushganda hammasini bir marta o'qib xotiraga oladi va har o'zgarishda backendga yozadi. Shu sababli konteyner qayta yaratilsa ham foydalanuvchilar tizimdan chiqib ketmaydi. Eski `.sessions.json` fayli endi ishlatilmaydi.
- **Bot faqat bitta instansda ishlashi kerak.** Long polling ikkitasini ko'tarmaydi, va sessiya keshi jarayon ichida turadi — ikkinchi instans eskirgan keshda ishlaydi.
- Webhook rejimi qo'llab-quvvatlanadi: `.env` da `USE_WEBHOOK=true` va `WEBHOOK_URL` ni bering.
- Bildirishnoma yuborish (eslatma) backend cron'i tomonidan Telegram Bot API orqali amalga oshiriladi — bot bu xabarlarni qabul qiluvchi kanal.

## ⚠️ Muhim: BOT_SHARED_SECRET

`.env`dagi `BOT_SHARED_SECRET` backend'dagi xuddi shu qiymatga teng bo'lishi **shart**. U ikki narsani ochadi:

1. `/register` orqali OTP'siz ro'yxatdan o'tish (mos kelmasa backend OTP so'raydi, bot esa buni hal qila olmaydi);
2. sessiya do'koni (`/api/bot/sessions`) — mos kelmasa **bot umuman ishga tushmaydi** va `Session store unreachable: HTTP 403` xatosini beradi.

Bu kalit har bir bot foydalanuvchisining access va refresh tokenini ochadi — uni brauzer klientiga hech qachon bermang.

---

# Tuzatish: "Men qarzdorman" yo'nalishi endi ishlaydi

Oldin `direction` hamma joyda qattiq `'given'` deb kodlangan edi — oddiy foydalanuvchi hech qachon "men qarzdorman" yozuvini kirita olmasdi (TZ 3.3-band talabi buzilgan edi).

**Tuzatildi:** `addDebtConversation` endi `sess.role === 'personal'` bo'lganda qarz yozish oqimida yo'nalish so'raydi (inline tugmalar: "➕ Menga qarzdor" / "➖ Men qarzdorman"). Do'kon egasi/xodim uchun xatti-harakat o'zgarmagan — ular hamon avtomatik `given`.

Tekshirildi: barcha 42 ta tarjima kaliti ikkala tilda ham mavjud, modul yuklanishi va bot yig'ilishi xatosiz, yo'nalish tanlash mantig'i (callback data parsing, xavfsiz standart qiymat bilan) unit-test qilindi.
