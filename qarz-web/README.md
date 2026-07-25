# Qarz.uz — Admin veb-sayt (React)

Do'kon egasi uchun boshqaruv paneli. Vite + React + React Router, backend API bilan ishlaydi. Minimal, tushunarli dizayn.

## Texnologiyalar
- **Vite + React 19** (ESM)
- **React Router** — himoyalangan yo'nalishlar
- **Kutubxonasiz SVG grafik** — bundle kichik qoladi
- **CSS o'zgaruvchilari** — bitta dizayn tokenlari tizimi

## O'rnatish
```bash
npm install
cp .env.example .env     # VITE_API_BASE_URL ni backend manziliga sozlang
npm run dev              # http://localhost:5173
npm run build            # ishlab chiqarish uchun (dist/)
```
Backend ishga tushgan bo'lishi kerak (qarz-backend).

## Sahifalar
| Yo'l | Tavsif |
|---|---|
| `/login` | Kirish + do'kon ochish (14 kun bepul) |
| `/` | Boshqaruv paneli — 4 ta ko'rsatkich + savdo grafigi |
| `/debtors` | Qarzdorlar — qidiruv, filtr, tarix, qarz yozish, to'lov, to'lov linki |
| `/sales` | Kunlik savdo kiritish + so'nggi 14 kun |

## Dizayn tizimi
Barcha ranglar/o'lchamlar `src/styles/global.css` da CSS o'zgaruvchilari sifatida:
- **Palitra:** sovuq qog'oz (`--paper`) + siyoh (`--ink`), bitta xotirjam indigo urg'u (`--accent: #3b4cca`), semantik status ranglari
- **Tipografika:** Inter; pul summalari `font-variant-numeric: tabular-nums` bilan — ustunlar tekis turadi
- **Geometriya:** 10px radius, yengil soyalar

## Struktura
```
src/
├─ App.jsx                 # routing + himoyalangan yo'nalishlar
├─ lib/
│  ├─ api.js               # backend klienti + avtomatik token yangilash
│  ├─ auth.jsx             # AuthProvider (JWT base64url dekodlash)
│  └─ format.js            # som(), grp(), fmtDate(), statusMeta
├─ components/
│  ├─ Layout.jsx           # sidebar navigatsiya
│  ├─ SalesChart.jsx       # SVG stacked bar grafik
│  ├─ DebtorDetail.jsx     # tarix + qarz yozish + to'lov + link
│  ├─ AddDebtorForm.jsx, Modal.jsx, Toast.jsx, PageHeader.jsx
└─ pages/
   └─ Login.jsx, Dashboard.jsx, Debtors.jsx, Sales.jsx
```

## Sifat
- Responsive (mobilgacha), klaviatura fokusi ko'rinadi, `prefers-reduced-motion` hurmat qilinadi
- API noto'g'ri javob qaytarsa sahifa "oq ekran"ga tushmaydi — xato toast ko'rsatiladi
- Tokenlar `localStorage` da, 401 da avtomatik `refresh`

## Keyingi bosqich
Super Admin paneli (alohida URL/login), ikki tilli i18n (bot'dagi kabi uz/ru), xodimlar boshqaruvi.

---

# Qo'shimcha funksiyalar

- **Parolni ko'rsatish/yashirish** — 👁 tugmasi (Login formasida)
- **Ikki bosqichli ro'yxatdan o'tish** — telefon+parol → SMS kod → akkaunt yaratiladi
- **Dark mode** — sidebar'dagi oy/quyosh tugmasi, `localStorage`da saqlanadi, standart holatda tizim sozlamasiga ergashadi
- **Mijozni tahrirlash/arxivlash** — `DebtorDetail` ichida ✏️/🗑 tugmalari
- **Summa formatlash** — barcha pul kiritish maydonlarida jonli guruhlash ("4500000" → "4 500 000"), kursor pozitsiyasi saqlanadi
- **Sanalar filtri** — Dashboard'da 7 kun / 30 kun / Joriy oy / Boshqa (tanlov saqlanadi)
- **Trial banner** — sinov muddati va uning tugashi haqida ogohlantirish
- **Super Admin paneli** — `/super-admin/*`, alohida sidebar, faqat `role === 'super_admin'` kira oladi:
  - `/super-admin` — do'konlar ro'yxati + platforma statistikasi + bloklash
  - `/super-admin/plans` — tariflarni tahrirlash
  - `/super-admin/audit-log` — faoliyat jurnali

## Tekshirildi (brauzerda, Playwright)
19 ta stsenariy, 0 ta JS xato: parol ko'rsatish, OTP ro'yxatdan o'tish oqimi, trial banner, sanalar filtri, dark mode (yoqilishi + reload'dan keyin saqlanishi), mijoz validatsiyasi, summa formatlash, tahrirlash/arxivlash (modal to'g'ri ochiq/yopiq holati bilan), Super Admin sahifalari, va rol chegaralari (do'kon egasi Super Admin panelga kira olmaydi va aksincha).

---

# Xodimlar boshqaruvi (`/staff`)

Do'kon egasi uchun yangi sahifa — backend'da avvaldan tayyor bo'lgan `POST/GET/PATCH/DELETE /api/shop/staff` endpointlarini ishlatadi:
- Xodim qo'shish (telefon + vaqtinchalik parol)
- Bloklash/faollashtirish
- O'chirish (tasdiqlash bilan)
- Tarif limiti to'lganda (`422 PLAN_LIMIT_REACHED`) xato aniq toast orqali ko'rsatiladi

**Rolga bog'liq ko'rinish:** "Xodimlar" havolasi faqat `shop_owner` uchun sidebar'da chiqadi. `staff` rolidagi foydalanuvchi to'g'ridan-to'g'ri `/staff` manziliga kirmoqchi bo'lsa ham, backend baribir `403` qaytargani uchun frontend ham uni avtomatik bosh sahifaga qaytaradi (backend bilan mos xatti-harakat).

Tekshirildi: brauzerda 12 ta stsenariy, jumladan ikkita rol chegarasi — `staff` uchun havola yashirin va to'g'ridan-to'g'ri kirish rad etiladi.

---

# Yangi: Xabar yuborish (Super Admin)

`/super-admin` sahifasida "📢 Barcha do'kon egalariga xabar yuborish" tugmasi. Bosilganda forma ochiladi, xabar yozilib yuboriladi — natijada nechta Telegram, nechta SMS orqali yetganini ko'rsatadi. Bo'sh xabar bilan yuborish tugmasi client tomonda o'chirilgan holda qoladi.

Tekshirildi: 12 ta brauzer stsenariysi — forma ochilishi, to'g'ri xabar yuborilishi, muvaffaqiyat toast'i (yetkazilish sonlari bilan), yuborilgandan keyin forma yopilishi, bo'sh xabarda tugma o'chirilgan holda qolishi.

---

# Tuzatish: Oddiy foydalanuvchi roli endi to'liq ishlaydi

Avval `personal` rol veb-saytda deyarli ishlatib bo'lmas edi:
- Ro'yxatdan o'tish uchun hech qanday tugma yo'q edi (faqat "Do'kon oching")
- Bosh sahifa har doim do'kon Dashboard'iga yo'naltirar edi — `personal` foydalanuvchi uchun bu doim `403` berardi
- `direction` hamma joyda `'given'`ga qattiq bog'langan edi — "men qarzdorman" yozib bo'lmasdi

**Tuzatildi:**
- Login sahifasida uchinchi variant: "Bepul boshlash" (OTP orqali ro'yxatdan o'tish, do'kon ochishga o'xshab)
- Bosh sahifa (`/`) rolga qarab farqlanadi: `personal` uchun to'g'ridan-to'g'ri qarzlar ro'yxati, do'kon uchun Dashboard
- Navigatsiya `personal` uchun "Boshqaruv paneli" va "Kunlik savdo"ni yashiradi (ular baribir `403` berardi)
- Qarz yozishda yo'nalish tanlash ("Menga qarzdor" / "Men qarzdorman") — faqat `personal` uchun
- Qarzdorlar ro'yxati va tafsilot sahifasi ikki tomonlama qoldiqni alohida ko'rsatadi (`outstanding_given` / `outstanding_taken`)

Tekshirildi: 13 ta brauzer stsenariysi (ham personal, ham shop_owner oqimi, regressiyasiz), backend'da 9 ta HTTP test — aralash given/taken qarzlar to'g'ri hisoblanishini tasdiqlaydi.
