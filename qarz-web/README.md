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
