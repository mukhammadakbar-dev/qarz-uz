# ADR-0001 — Stack, repo tuzilmasi va deploy

**Status:** Qabul qilingan (2026-10-07)
**Bog‘liq:** TT §38, §45; Reja §0, §1.2

## Kontekst

TT MVP uchun modular monolith tavsiya qiladi (§38). Microservices, Kafka va Kubernetes kerak emas. Deploy oddiy VPS'ga qilinadi, Docker prod'da ishlatilmaydi. Jamoa kichik, shuning uchun bitta til va minimal harakatlanuvchi qismlar afzal.

## Qaror

| Soha | Tanlov |
|---|---|
| Til / runtime | TypeScript (`strict`, `noUncheckedIndexedAccess`), Node 22 LTS yoki undan yuqori |
| HTTP | Fastify (webhook va Mini App API bitta jarayonda) |
| Bot | grammY (webhook rejimi prod'da, long polling faqat dev'da) |
| DB | PostgreSQL 16, `pg_trgm` kengaytmasi |
| DB kirish | Kysely (typed query builder) + oddiy SQL migratsiyalar. ORM ishlatilmaydi, chunki `FOR UPDATE`, trigger, RLS va generated ustunlar bilan ochiq ishlash kerak |
| Validatsiya | zod (env, HTTP, LLM chiqishi) |
| Mini App | React + Vite + `@telegram-apps/sdk` |
| Monorepo | pnpm workspaces: `apps/server`, `apps/miniapp`, `packages/shared`, `packages/nlp-eval` |
| Test | vitest, fast-check (property testlar), **real PostgreSQL** (pg-mem emas: trigger, RLS va lock'lar kerak) |
| Lint / format | oxlint + prettier |
| Log / xato | pino (redaction bilan) + Sentry |
| Deploy | VPS + Nginx (TLS) + PM2 (`ecosystem.config.cjs`). Docker-compose **faqat lokal dev** uchun (Postgres) |

### Server modullari

`identity`, `tenancy`, `billing`, `customers`, `ledger`, `interpretation`, `conversation`, `bot`, `api`, `audit`, `analytics`.

Qoidalar:
- Modul boshqa modulning ichki fayllarini import qilmaydi, faqat uning `index.ts` eksportini ishlatadi (lint qoidasi bilan majburlanadi).
- `ledger` modulidan boshqa hech qayerda `ledger_entries` jadvaliga yozilmaydi.
- `interpretation` moduli DB'ga umuman murojaat qilmaydi. Mijoz topish (`resolver`) alohida, `customers` moduli orqali ishlaydi.

### Jarayonlar va cron

- PM2 da bitta `fork` rejimli jarayon. Cron job'lar (reconciliation, eslatmalar, retention) shu jarayon ichida ishlaydi.
- Har bir job `pg_try_advisory_lock` bilan himoyalanadi. Keyinchalik ikkinchi instance qo‘shilsa, job ikki marta ishlamaydi.
- Graceful shutdown: yangi webhook qabul qilinmaydi, davom etayotgan tranzaksiyalar tugaydi, keyin chiqiladi.

### Migratsiyalar

- Raqamlangan SQL fayllar (`0001_*.sql`), faqat oldinga (forward-only). Migratsiya `migrator` roli bilan ishlaydi.
- Ilova `app` roli bilan ulanadi. Bu rolda `ledger_entries` ustida `UPDATE` va `DELETE` huquqi yo‘q (ADR-0002).

### Muhit

- Konfiguratsiya faqat env orqali, zod bilan validatsiya qilinadi. Qiymat yetishmasa jarayon ishga tushmaydi.
- Secretlar repo'ga yozilmaydi. Prod'da fayl `chmod 600`, PM2 env fayldan o‘qiydi.

## Ko‘rib chiqilgan muqobillar

- **Express + ORM (avvalgi loyiha stack'i):** tip xavfsizligi kamroq, ledger uchun kerakli past darajadagi SQL ORM orqali noqulay.
- **NestJS:** MVP uchun ortiqcha qatlamlar.
- **Telegraf:** grammY'da tiplar va middleware modeli yaxshiroq.
- **Docker prod'da:** oddiy VPS va PM2 qarori bilan mos kelmaydi, operatsion murakkablik qo‘shadi.

## Oqibatlar

- Bitta deploy birligi, oddiy rollback (`git checkout` + `pm2 reload`).
- Webhook va API bir jarayonda, shuning uchun ikkalasi uchun umumiy rate limit va yuklama hisobga olinadi.
- Gorizontal scale kerak bo‘lganda: jarayonlar sonini oshirish mumkin, chunki barcha holat DB'da (conversation, draft, idempotency), xotirada emas.
