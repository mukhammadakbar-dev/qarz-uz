# Xavfsizlik review (T6.1) — 2026-10-09

Qamrov: authz, initData/sessiya, prompt-injection, bog‘liqliklar, secret rotation. Kodni o‘qish va mavjud testlar bilan tasdiqlangan; tashqi penetratsiya testi o‘tkazilmagan.

## Natija

| Soha                     | Holat | Asos                                                                                                                                                                                                                                                            |
| ------------------------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route autentifikatsiyasi | ✅    | Har `/api/*` route `authenticate` / `requireBusiness(permission)` / `requireSuperadmin` bilan. `api/route-guards.test.ts` yangi himoyasiz route qo‘shilsa CI’da yiqiladi. Ochiq: faqat `/api/auth/telegram`                                                     |
| Tenant isolation         | ✅    | Biznes/rol har so‘rovda DB’dan; `X-Business-Id` faqat selector; PostgreSQL RLS (ADR-0006); `isolation.int.test.ts` matritsasi                                                                                                                                   |
| Superadmin               | ✅    | Telegram ID `SUPERADMIN_TELEGRAM_IDS` da bo‘lmasa 404; do‘kon ma’lumoti faqat o‘qiladi va auditga yoziladi (ADR-0008)                                                                                                                                           |
| initData                 | ✅    | HMAC (`WebAppData`), `timingSafeEqual`, takroriy maydon rad, `auth_date` kelajak/eskirish tekshiruvi, 8 KB limit; `identity.test.ts`                                                                                                                            |
| Sessiya tokeni           | ✅    | HMAC-SHA256, `typ`/versiya/`exp`; faqat `user_id` tashiydi (rol DB’dan, shuning uchun a’zolikni bekor qilish darhol kuchga kiradi)                                                                                                                              |
| Prompt-injection         | ✅    | LLM faqat niyat beradi; chiqishi zod sxema bilan cheklangan va matnga «ildiz otgan» bo‘lishi shart (`groundingProblem`); xavfsizlik rad etishlarini LLM bekor qila olmaydi; har yozuv tasdiq bosqichidan o‘tadi. Testlar: `merge.test.ts`, `gemini.int.test.ts` |
| Bog‘liqliklar            | ✅    | `pnpm audit --prod`: 0 zaiflik (`valibot` ≥1.4.2 `pnpm-workspace.yaml` overrides orqali; Mini App SDK tranzitiv). Dev’da 1 past daraja qoldi                                                                                                                    |
| Secret rotation          | ✅    | `docs/RUNBOOK.md` §7                                                                                                                                                                                                                                            |

## Qabul qilingan xavflar

1. **initData replay.** Ushlab olingan `initData` `INITDATA_MAX_AGE_SECONDS` (standart 24 soat) ichida yangi sessiya olish uchun ishlaydi. Telegram initData’ni Mini App ochiq turgan vaqtda yangilamaydi, shuning uchun muddatni qisqartirish uzoq ochiq ilovani «qayta oching» holatiga tushiradi. Ta’sir cheklangan: sessiya 1 soat, ma’lumot faqat shu foydalanuvchining o‘ziniki, yozuvlar `Idempotency-Key` talab qiladi. Zarur bo‘lsa `INITDATA_MAX_AGE_SECONDS=3600`.
2. **`trustProxy: true`.** IP bo‘yicha rate limit `X-Forwarded-For` ga tayanadi. 3100 port faqat Docker tarmoqlaridan ochiq (faervol), Caddy esa tashqi `X-Forwarded-For` ni qayta yozadi. Port internetga ochilsa, IP limiti aldanishi mumkin: faervol qoidasini o‘zgartirmang.
3. **Sessiyani majburan bekor qilish yo‘q.** Token 1 soatdan keyin o‘ladi; zudlik bilan hammasini bekor qilish kerak bo‘lsa `SESSION_SECRET` almashtiriladi (RUNBOOK §7).
4. **Rate limit xotirada** (bitta PM2 instance, ADR-0001). Bir nechta instance’ga o‘tilganda umumiy saqlash (Redis/DB) kerak.

## Qolgan (T6.1 dan tashqari)

- Tashqi penetratsiya testi / bug bounty — pilotdan keyin.
- Jonli Gemini bilan injection eval (`eval:llm`ga adversarial namunalar qo‘shish) — T6.7 bilan birga.
