# ADR-0007 — Mini App: arxitektura va xavfsizlik qarorlari

**Status:** Qabul qilingan (2026-10-08)
**Bog‘liq:** TT §31–34, ADR-0003 §3, ADR-0006

## Qaror

- **Stack:** React 19 + Vite + TypeScript, `@tanstack/react-query` (so‘rovlar keshi), `react-router` (**HashRouter**: Telegram `#tgWebApp...` parametrlarini hash'da beradi, yo‘l esa `/app/` ostida qoladi, server tomonida SPA fallback kerak emas), `@telegram-apps/sdk` (tema, back button, haptic).
- **Taqdim etish:** Node jarayonining o‘zi `@fastify/static` bilan `/app/` ostida beradi (alohida hosting yo‘q). `index.html` `no-cache`, hash'langan aktivlar `immutable`.
- **Autentifikatsiya:** `initData` → `POST /api/auth/telegram` → qisqa muddatli sessiya tokeni (ADR-0006). Token **faqat xotirada** (localStorage/cookie emas). 401 olinsa bir marta qayta kiriladi.
- **Tenant:** `X-Business-Id` faqat selektor; server har so‘rovda a'zolik va rolni DB'dan tekshiradi. Mini App'dagi rol bo‘yicha yashirish (Xodimlar/Sozlamalar) faqat qulaylik, himoya serverda (`T4.6` matritsasi).
- **Idempotentlik:** yozuv yaratuvchi hamma POST `Idempotency-Key` talab qiladi. Mini App'da **bir foydalanuvchi niyati = bir kalit**: tarmoq xatosidan keyin “Saqlash” shu kalit bilan qayta yuboriladi; summa/izoh/sana o‘zgarsa yoki muvaffaqiyatdan keyin kalit almashadi. Server tomonda `idempotency_keys` jadvali (RLS user bo‘yicha) va ledger kaliti `api:<user>:<key>`.
- **Tasdiq oqimi:** server `preview` beradi (qoldiq, ruxsat), UI tasdiq oynasi ko‘rsatadi; yakuniy qaror baribir `LedgerService`da (ortiqcha to‘lov DB darajasida ham yozilmaydi).
- **Xavfsizlik sarlavhalari:** CSP (`script-src 'self'`, `frame-ancestors` Telegram Web uchun), `X-Frame-Options` yo‘q, CORS faqat sozlangan originlar, foydalanuvchi tokeni bo‘yicha rate limit (auth uchun IP bo‘yicha qattiqroq).
- **Chuqur havola:** bot `web_app` tugmasi `?c=<mijoz-id>` bilan ochadi; ilova uni (UUID formatini tekshirib) mijoz sahifasiga o‘tkazadi. ID baribir serverda a'zolik bilan tekshiriladi.
- **Til:** foydalanuvchi tili (`/lang`) serverdan olinadi (uz-Latn / uz-Cyrl); Mini App'da alohida til almashtirgich yo‘q.

## Ma’lum cheklovlar

- Telegram ichida va haqiqiy qurilmada hali sinalmagan; komponent testlari jsdom'da, API testlari real Postgres bilan.
- Saqlangan yozuvni “tahrirlash” (storno + yangi yozuv bitta tranzaksiyada) yo‘q: foydalanuvchi o‘chirib, qayta yozadi.
- Offline rejim yo‘q: aloqa yo‘q bo‘lsa xabar ko‘rsatiladi, yozuv navbatga olinmaydi (pul uchun ataylab).
