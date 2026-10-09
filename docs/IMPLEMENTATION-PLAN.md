# Telegram Nasiya — Implementation Plan

**Asos:** `docs/Texnik-Topshiriq.md` (v1.0)
**Holat:** Tasdiqlangan qarorlar bilan, kod yozishdan oldingi reja
**Sana:** 2026-10-07

---

## Bajarilish holati

| Bosqich                                                                                            | Holat                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 (ADR, golden dataset)                                                                      | ✅ tayyor                                                                                                                                                                                                                                    |
| Phase 1 T1.1–T1.10 (scaffold, config, DB, log, CI, sxema/RLS, webhook, identity, RBAC, onboarding) | ✅ tayyor                                                                                                                                                                                                                                    |
| Phase 1 T1.11 (staging)                                                                            | 🟡 kod va hujjat tayyor (build, PM2, nginx, DB bootstrap, `deploy.sh`, `docs/DEPLOY.md`); serverda hali sinalmagan                                                                                                                           |
| Phase 2 (Ledger)                                                                                   | ✅ tayyor                                                                                                                                                                                                                                    |
| Phase 3 (interpretatsiya, bot UX)                                                                  | ✅ tayyor (Gemini jonli sinalmagan: model `eval:llm` bilan tanlanadi)                                                                                                                                                                        |
| Phase 4 (Mini App) + qayta dizayn, bot menyusi, superadmin paneli (ADR-0008)                       | ✅ tayyor                                                                                                                                                                                                                                    |
| Phase 5 (billing: `/sub`, `/extend`, `/expiring`, eslatmalar, gating testlari)                     | ✅ tayyor                                                                                                                                                                                                                                    |
| Phase 6 (hardening, production)                                                                    | 🟡 T6.1 (`docs/SECURITY.md`), T6.2 (foydalanuvchi chegarasi, 429 qayta urinish), T6.3 (operator ogohlantirishlari, watchdog), T6.5 (offsite zaxira kodi), T6.8 (`docs/RUNBOOK.md`) yozildi; serverga o‘rnatilmagan. Qolgan: T6.4, T6.6, T6.7 |

---

## 0. Qabul qilingan qarorlar (ADR qisqacha)

| #   | Mavzu                   | Qaror                                                                                                                                                                              |
| --- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Ortiqcha to‘lov         | **Hech qachon bo‘lmaydi — rad etiladi.** Invariant: `balance >= 0` har doim. DB darajasida ham majburlanadi.                                                                       |
| Q2  | Staff huquqlari         | Staff **butun tarixni ko‘radi** va yozuvni **o‘chira oladi**. TT §3.2 dagi "faqat o‘z operatsiyalari" cheklovi bekor.                                                              |
| Q3  | "O‘chirish" semantikasi | Ledger o‘zgarmas: o‘chirish = **storno** (teskari yozuv). Yozuv tarixda "o‘chirilgan" deb ko‘rinadi, balansga ta'sir qilmaydi.                                                     |
| Q4  | AI                      | **Gemini API** (MVP). Ism va summa yuboriladi; telefon/karta/ortiqcha PII redaksiya qilinadi. LLM faqat intent qaytaradi. `AIProvider` abstraksiyasi saqlanadi (keyin Qwen/local). |
| Q5  | Stack                   | **TypeScript + Fastify + grammY**, PostgreSQL 16, React+Vite Mini App. Deploy: **VPS + PM2 + Nginx**.                                                                              |
| Q6  | Obuna                   | **14 kun bepul trial**, keyin **29 000 so‘m/oy**, to‘lov boshida **qo‘lda** (Telegramda admin orqali). Online gateway — keyin.                                                     |
| Q7  | Repo                    | Noldan qayta quriladi; eski `qarz-*` kod ishlatilmaydi.                                                                                                                            |
| —   | Pul birligi             | `BIGINT`, **butun so‘m** (tiyin yo‘q). Float hech qayerda.                                                                                                                         |
| —   | Vaqt zonasi             | `Asia/Tashkent` (biznes darajasida saqlanadi).                                                                                                                                     |
| —   | Tasdiqlash              | MVP'da **har qanday** moliyaviy yozuv faqat tugma bosilgandan keyin yoziladi (TT §16 "minimal confirmation" ham tugma).                                                            |

### Qo‘shimcha qarorlar (2026-10-07 da tasdiqlangan)

- **D-a. Obuna tugaganda:** biznes **read-only** bo‘ladi. Ko‘rish va qidiruv ishlaydi, yangi nasiya, to‘lov va o‘chirish bloklanadi. Ma'lumot "garovga olinmaydi".
- **D-b. Staff yozuvni o‘chirsa:** owner'ga Telegram xabar boradi (firibgarlikka qarshi). Biznes sozlamasida o‘chirib qo‘yish mumkin.
- **D-c. O‘chirishda vaqt cheklovi yo‘q.** Sabab ixtiyoriy.
- **D-d. Trial bitta owner (Telegram user) uchun bir marta beriladi.** Yangi biznes ochish yangi trial bermaydi.

---

## 1. Arxitektura

### 1.1. Qatlamlar

| Qatlam                             | Savoli                                         | Xato qilishi mumkinmi                       |
| ---------------------------------- | ---------------------------------------------- | ------------------------------------------- |
| Interpreter (Gemini + rule parser) | "User nimani nazarda tutdi?"                   | Ha — faqat taxmin                           |
| Decision policy (toza funksiya)    | "Bajarish xavfsizmi, nima so‘rash kerak?"      | Yo‘q — exhaustive testlangan                |
| Ledger service (tranzaksion)       | "Atomik, yagona marta, invariantlar bilan yoz" | Yo‘q — DB constraint'lar bilan himoyalangan |

### 1.2. Tuzilma (pnpm monorepo)

```text
apps/server        # Fastify + grammY, bitta PM2 jarayoni (webhook + API + cron)
  src/modules/
    identity/      # users, Telegram auth, initData
    tenancy/       # businesses, members, invites, RBAC, RLS context
    billing/       # trial, obuna, admin buyruqlari, eslatmalar
    customers/
    ledger/        # LedgerService, balans proyeksiyasi, storno, reconciliation
    interpretation/# normalize, rule parser, AIProvider (Gemini), grounding, resolver
    conversation/  # state machine, pending_operations (draft)
    bot/           # grammY handler'lari, shablonlar, klaviaturalar
    api/           # Mini App REST
    audit/  analytics/
apps/miniapp       # React + Vite + @telegram-apps/sdk
packages/shared    # normalizer, money, intent tiplari, i18n kalitlari
packages/nlp-eval  # golden dataset + eval runner
```

Modullar bir-biriga faqat public service interfeysi orqali murojaat qiladi.

### 1.3. Ledger invariantlari

- `type`: `DEBT`, `PAYMENT`, `ADJUSTMENT`.
- `DEBT` va `PAYMENT` uchun `amount > 0`. `ADJUSTMENT` ishorali (`amount ≠ 0`).
- Generated ustun: `delta = CASE DEBT → +amount, PAYMENT → −amount, ADJUSTMENT → amount`.
- `balance = SUM(delta)` (TT §23 formulasiga ekvivalent).
- **Storno ("o‘chirish"):**
  - `ADJUSTMENT`, `delta = −original.delta`, `reverses_entry_id = original.id`.
  - `UNIQUE(reverses_entry_id)` — bitta yozuv faqat bir marta o‘chiriladi.
  - Stornoning o‘zini o‘chirib bo‘lmaydi.
  - Tarixda original yozuv "o‘chirildi — {kim}, {qachon}" bilan chiziladi.
- **`balance >= 0` invarianti:**
  - `customer_balances.balance CHECK (balance >= 0)` qo‘yiladi. Proyeksiya ledger bilan bitta tranzaksiyada yangilanadi, shuning uchun ilova xato qilsa ham tranzaksiya ROLLBACK bo‘ladi.
  - Natijalar:
    - qarzdan katta to‘lov → rad;
    - qarzi 0 mijozga to‘lov → rad;
    - yangi (noma'lum) mijozga to‘lov → rad;
    - **to‘lovlari bor DEBT'ni o‘chirish, agar balans manfiy bo‘lib qolsa → rad**. Xabar: "Avval keyingi to‘lovni o‘chiring" (yoki qoldiq yetarli bo‘lsa ruxsat).
- **O‘zgarmaslik.** App DB rolida `ledger_entries` ustida UPDATE/DELETE grant yo‘q, qo‘shimcha ravishda trigger UPDATE/DELETE'ni bloklaydi.
- **Kiritilgan yozuvni tuzatish ("O‘zgartirish"):** storno va yangi yozuv bitta tranzaksiyada qilinadi.
- **Konkurentlik.** Har bir moliyaviy tranzaksiyada `customers` qatori `SELECT … FOR UPDATE` bilan bloklanadi. Balans va invariantlar lock ostida qayta tekshiriladi.
- **Reconciliation.** Kunlik job `customer_balances` qiymatini `SUM(delta)` bilan solishtiradi va farq bo‘lsa alert beradi.

### 1.4. Idempotentlik (3 qatlam)

1. **Update darajasi:** `processed_updates(update_id PK)` — webhook dublikatlarini filtrlaydi (best-effort).
2. **Moliyaviy darajasi (asosiy kafolat):**
   - Har bir yozuv draft'dan (`pending_operations`) tug‘iladi.
   - `ledger_entries UNIQUE(business_id, idempotency_key)` va `idempotency_key = draft_id`.
   - Draft `UPDATE … SET status='COMMITTED' WHERE status='PENDING'` bilan o‘tkaziladi.
   - "Saqlash" ikki marta bosilsa ham, retry bo‘lsa ham, ledger'da 1 ta yozuv bo‘ladi.
   - Matnli xabarni qayta ishlash faqat yangi draft yaratadi, pul yozuvi yaratmaydi.
3. **Mini App:** POST so‘rovlar `Idempotency-Key` header bilan keladi. Javob saqlanadi va takroriy so‘rovga o‘sha javob qaytariladi.

### 1.5. Xavfsizlik va tenant isolation

- **Bot:** `X-Telegram-Bot-Api-Secret-Token` tekshiriladi, faqat private chat, `allowed_updates` cheklangan.
- **Mini App:** `initData` HMAC va `auth_date` muddati tekshiriladi, keyin qisqa muddatli session token beriladi.
- **Membership, role va obuna holati har so‘rovda DB'dan o‘qiladi.** Shu sababli revoke darhol ta'sir qiladi.
- **Tenant isolation:**
  - Repository funksiyalari `businessId`'ni majburiy parametr sifatida oladi.
  - **PostgreSQL RLS** (`SET LOCAL app.business_id`) qo‘shimcha himoya qatlami.
  - Klient yuborgan `business_id`/`customer_id` faqat selector; server har safar membership bilan tekshiradi.
- **RBAC:** permission map kodda saqlanadi va kengaytiriladi.

| Permission                                    | OWNER | STAFF |
| --------------------------------------------- | ----- | ----- |
| customer.create / update / view               | ✔     | ✔     |
| ledger.debt / payment                         | ✔     | ✔     |
| ledger.history.view (butun)                   | ✔     | ✔     |
| ledger.entry.delete (storno)                  | ✔     | ✔     |
| ledger.adjustment (qo‘lda ±)                  | ✔     | —     |
| customer.archive                              | ✔     | —     |
| staff.manage, business.settings, billing.view | ✔     | —     |

- **Superadmin:** `SUPERADMIN_TELEGRAM_IDS` env orqali beriladi. Mini App'dagi Admin panel (ADR-0008): do‘kon ma'lumotlarini faqat o‘qiydi (audit bilan), obunani uzaytiradi, do‘konni bloklaydi, ommaviy xabar yuboradi.

### 1.6. AI / NLP pipeline

```text
xabar
 → [1] Normalize (NFC, apostroflar, Kirill→Lotin, lowercase)
 → [2] Rule parser (deterministik)       ┐ parallel
 → [3] PII redaction → GeminiProvider    ┘
 → [4] Grounding check + rule∩LLM kelishuvi → StructuredIntent (+confidence'lar)
 → [5] Customer resolver (DB, deterministik)
 → [6] Decision policy (toza funksiya)
 → Action → draft → [Saqlash] → LedgerService (tx, lock, re-validate)
```

- **Gemini:**
  - `@google/genai`, `responseMimeType: application/json` va `responseSchema`, `temperature: 0`.
  - Few-shot misollar Lotin, Kirill va aralash yozuvda.
  - `GEMINI_MODEL` env orqali sozlanadi; model **golden set eval** natijasiga ko‘ra tanlanadi.
  - Timeout ~3 s, 1 marta retry, circuit breaker.
  - **Pullik tier** ishlatiladi: bepul tier shartlarida kontent mahsulotni yaxshilash uchun ishlatilishi mumkin.
- **Uzbek aniqligi ustuvor:**
  - Gemini har bir erkin matn uchun chaqiriladi.
  - Rule parser parallel ishlaydi va natijalar solishtiriladi:
    - **ikkalasi kelishsa** → high confidence;
    - **kelishmasa** → clarification;
    - **Gemini ishlamasa** → faqat rule natijasi, qat'iyroq tasdiqlash bilan.
  - State javoblari ("100 ming", "Birinchisi", tugmalar) LLM'siz, deterministik ishlanadi.
- **Grounding:**
  - LLM bergan `amount` rule parser matndan topgan summalardan biri bo‘lishi kerak (yoki FULL/FRACTION).
  - `customer_mention` normallashtirilgan input'ning bir qismi bo‘lishi kerak.
  - Shartlar bajarilmasa → low confidence → savol.
- **PII redaction:**
  - Telefon (`+998…`, 9 raqamli operator formatlari) va 16 xonali karta raqamlari yuborilmaydi.
  - Testlar summalar (`900 000`, `1 200 000`) buzilmasligini kafolatlaydi.
- **LLM'ga DB, customer ro‘yxati yoki tool berilmaydi.** Chiqish intent enum'i bilan cheklangan va zod bilan tekshiriladi, shu sababli prompt-injection ta'sirsiz.
- **`AIProvider` interfeysi:** `interpret(message, context) → StructuredIntent`. Implementatsiyalar: `RuleProvider`, `GeminiProvider`; keyin `QwenProvider`/local.

**Resolver:**

- bitta aniq moslik → mijoz aniqlandi (tasdiq oynasida baribir ko‘rsatiladi);
- ≥2 moslik, yoki faqat prefix/fuzzy moslik ("Murod" vs "Murodbek") → **savol beriladi**, tugmalar va "+ Yangi mijoz" bilan;
- moslik yo‘q: DEBT uchun "Yangi mijoz yaratilsinmi?", PAYMENT uchun rad etiladi.

**Decision policy** quyidagi action'lardan birini qaytaradi:
`ASK_AMOUNT | ASK_CUSTOMER | CONFIRM | CONFIRM_FULL | CONFIRM_FRACTION | CONFIRM_NEW_CUSTOMER | REJECT_OVERPAY | REJECT_NO_DEBT | REJECT_INVALID_AMOUNT | WARN_LARGE_AMOUNT | SHOW_BALANCE | SHOW_HISTORY | BLOCKED_SUBSCRIPTION | UNKNOWN`

**Ortiqcha to‘lov xabari:**

```text
Murodning qarzi: 100 000 so‘m.
150 000 so‘m qabul qilib bo‘lmaydi — qarzdan ko‘p.

[100 000 so‘m yozish] [Boshqa summa] [Bekor qilish]
```

### 1.7. Obuna (billing)

- **Jadvallar:**
  - `subscriptions(business_id PK, trial_ends_at, paid_until, status_cache)`;
  - `subscription_payments(id, business_id, amount, months, period_from, period_to, recorded_by_admin, note, created_at)` — append-only.
- **Holat:**
  - `now < trial_ends_at` → TRIAL;
  - `now < paid_until` → ACTIVE;
  - aks holda → EXPIRED.
- **Uzaytirish:** `paid_until = max(now, paid_until, trial_ends_at) + N oy`.
- **Narx** `config`'da saqlanadi (`SUBSCRIPTION_PRICE_UZS=29000`), kodda hardcode qilinmaydi.
- **Biznesning qisqa kodi** (masalan `TD-4F7K`) bor: owner shu kodni adminga aytadi.
- **Admin bot buyruqlari** (faqat superadmin): `/sub <kod>` (holat), `/extend <kod> <oy> [izoh]`. Har bir amal audit'ga yoziladi.
- **Eslatmalar:** trial yoki obuna tugashiga 3 kun va 1 kun qolganda, hamda tugagan kuni yuboriladi. Xabarda "To‘lash" tugmasi admin kontaktiga olib boradi.
- **Gating:** obuna holati LedgerService ichida, tranzaksiyada tekshiriladi (UI'da emas). EXPIRED bo‘lsa read-only rejim yoqiladi.

---

## 2. Ma'lumotlar modeli (MVP)

```text
users              (id, telegram_user_id UNIQUE, username, first_name, last_name, locale, trial_used_at, created_at)
businesses         (id, name, short_code UNIQUE, owner_user_id, currency='UZS', timezone='Asia/Tashkent',
                    notify_owner_on_delete bool, created_at, updated_at)
business_members   (id, business_id, user_id, role[OWNER|STAFF], status[ACTIVE|REVOKED], created_at, revoked_at)
                   UNIQUE(business_id, user_id)
invites            (id, business_id, token_hash, role, expires_at, used_by, used_at, created_by)
subscriptions      (business_id PK, trial_ends_at, paid_until, updated_at)
subscription_payments (id, business_id, amount, months, period_from, period_to, recorded_by, note, created_at)
customers          (id, business_id, name, normalized_name, label, phone, notes, status[ACTIVE|ARCHIVED],
                    created_by, created_at, updated_at)     INDEX gin(normalized_name gin_trgm_ops)
ledger_entries     (id, business_id, customer_id, type, amount BIGINT, delta GENERATED, currency,
                    description, occurred_at, created_by, source[BOT|MINIAPP], idempotency_key,
                    reverses_entry_id UNIQUE NULL, interpretation_id, metadata JSONB, created_at)
                   UNIQUE(business_id, idempotency_key)
customer_balances  (customer_id PK, business_id, balance BIGINT CHECK(balance>=0), last_entry_id, updated_at)
pending_operations (id, business_id, user_id, chat_id, payload JSONB, status, expected_balance, expires_at, created_at)
conversation_state (chat_id, user_id PK, business_id, state, data JSONB, expires_at)
processed_updates  (update_id PK, received_at, status)
ai_interpretations (id, business_id, user_id, input_redacted, rule_output, llm_output, final_intent,
                    provider, model, prompt_version, latency_ms, outcome, created_at)   -- retention 30 kun
audit_logs         (id, business_id, actor_user_id, action, entity, entity_id, before, after, created_at)  -- append-only
product_events     (id, business_id, user_id, name, props JSONB, created_at)
idempotency_keys   (key, user_id, request_hash, response JSONB, created_at)
```

TT §25 modeliga qo‘shimchalar va sabablari:

| Qo‘shimcha                    | Sabab                 |
| ----------------------------- | --------------------- |
| `occurred_at`                 | "kecha yozgan edim"   |
| `idempotency_key`             | §28                   |
| `reverses_entry_id`           | o‘chirish (storno)    |
| `label`                       | §12 "Мурод — qo‘shni" |
| `locale`                      | §19                   |
| `short_code`, `subscriptions` | billing               |

---

## 3. Bosqichlar va vazifalar

Yozuv tartibi: **ID** — vazifa `← bog‘liqlik`, keyin ✔ bilan "tayyor" mezoni (DoD).

### Phase 0 — Tayyorgarlik

- **D-1** ADR'lar: stack, ledger, idempotentlik, AI pipeline, billing (shu hujjat asosida). ✔ `docs/adr/`
- **D-2** **Golden dataset v0** (kod yozishdan oldin):
  - TT §46 dagi barcha holatlar;
  - Lotin/Kirill/aralash va imlo variantlari;
  - ortiqcha to‘lov va o‘chirish holatlari;
  - kamida 200 ta input → kutilgan intent.

  ✔ `packages/nlp-eval/golden.jsonl`

### Phase 1 — Foundation

- **T1.1** Monorepo scaffold: pnpm, TS strict, oxlint, prettier, vitest. ✔ `pnpm lint typecheck test` ishlaydi
- **T1.2** Config: zod bilan validatsiya qilingan env, yetishmasa ishga tushmaydi (fail-fast); `.env.example`; secretlar repo'da emas. `← T1.1`
- **T1.3** Postgres: lokal docker-compose (faqat dev uchun), migratsiya vositasi, `migrator`/`app` rollari, forward-only migratsiyalar. `← T1.1`
- **T1.4** Logging va xatolar: pino + redaction (prod'da xabar matni yozilmaydi), `request_id`/`update_id`/`business_id`/`user_id`, typed `DomainError` → foydalanuvchiga tushunarli xabar, Sentry. `← T1.1`
- **T1.5** CI (GitHub Actions): lint, typecheck, unit, integratsion testlar real Postgres service bilan. `← T1.3`
- **T1.6** Schema: `users`, `businesses`, `business_members`, `invites`, `subscriptions`, `subscription_payments`, `audit_logs`, `processed_updates`. `← T1.3`
- **T1.7** Telegram ingress `← T1.4, T1.6`:
  - grammY webhook va secret token;
  - `allowed_updates`, faqat private chat;
  - update dedupe;
  - chat bo‘yicha ketma-ket ishlov (advisory lock).
- **T1.8** Identity: user upsert; Mini App `initData` HMAC va session token. `← T1.6`
- **T1.9** Authorization: membership resolver, RBAC map, `requirePermission`, RLS policy'lar, aktiv biznes tanlash. `← T1.8`
- **T1.10** Onboarding `← T1.7, T1.9`:
  - `/start` → biznes nomi → biznes, OWNER va subscription (trial 14 kun, `trial_used_at` bilan) bitta tranzaksiyada yaratiladi;
  - `/start inv_<token>` → staff ulanadi;
  - `/help`, `/menu`;
  - i18n (uz-Latn, uz-Cyrl).
- **T1.11** Staging: VPS, Nginx TLS, PM2 (`ecosystem.config.cjs`), setWebhook skripti, `/healthz`, graceful shutdown. `← T1.7`

### Phase 2 — Ledger core (service va testlar, bot UX'siz)

- **T2.1** Schema: `customers`, `ledger_entries`, `customer_balances` (`CHECK balance>=0`); immutability trigger, grant'lar, `pg_trgm`. `← D-1, T1.6`
- **T2.2** Money modul: BIGINT so‘m, limitlar (`1 ≤ amount ≤ 10 mlrd`), `450 000 so‘m` formatlash. `← T1.1`
- **T2.3** Normalizer (`packages/shared`): Kirill→Lotin, apostroflar, case. Bitta funksiya qidiruv, resolver va NLP uchun. Property testlar bilan. `← T1.1`
- **T2.4** Customer service: create (bir xil ism bo‘lsa `label` so‘raydi), update, archive (faqat balans 0 bo‘lsa), qidiruv, sort, cursor pagination. `← T2.1, T2.3`
- **T2.5** **LedgerService** `postDebt` / `postPayment` / `postAdjustment` `← T2.1, T2.2, T1.9`:
  - bitta tranzaksiyada: membership + obuna gating → customer `FOR UPDATE` → invariantlar → idempotency → insert → proyeksiya → audit;
  - ortiqcha to‘lov → `OverpaymentError`.
- **T2.6** `preview*` funksiyalari (yozmaydi): qoldiq, maksimal to‘lov, rad sabablari. `← T2.5`
- **T2.7** **Storno (o‘chirish)** `deleteEntry(entryId)` `← T2.5`:
  - takroriy o‘chirish rad etiladi (`UNIQUE`);
  - storno'ni o‘chirish rad etiladi;
  - balans < 0 bo‘lib qolsa rad etiladi;
  - audit yoziladi;
  - D-b bo‘yicha owner'ga xabar navbatga qo‘yiladi.
- **T2.8** Balans va tarix so‘rovlari (running balance, o‘chirilganlar belgisi bilan); reconciliation job. `← T2.5`
- **T2.9** Testlar `← T2.5–T2.8`:
  - 50 ta parallel to‘lov: invariant buzilmaydi, ortiqchasi rad etiladi;
  - dublikat idempotency key;
  - trigger UPDATE/DELETE'ni bloklashi;
  - fast-check: `balance == SUM(delta) ≥ 0`;
  - storno chekka holatlari;
  - service darajasida tenant isolation.

### Phase 3 — Interpretatsiya va Bot UX

- **T3.1** Eval harness: provider bo‘yicha metrikalar (intent, customer, amount, date accuracy, **wrong-financial-transaction rate**). `← D-2, T2.3`
- **T3.2** Amount extractor (`ming`/`минг`/`k`/`mln`/`million`/`yarim million`/ajratgichlar/`1,5 mln`). ✔ golden summalar bo‘yicha 100%. `← T2.2, T2.3`
- **T3.3** Rule parser: intent, ism (qo‘shimchalarni ajratish), FULL/FRACTION, sana, "yana". `← T3.2`
- **T3.4** `AIProvider` va **GeminiProvider** `← T3.1, T3.3`:
  - schema, few-shot misollar, timeout, retry, circuit breaker, `prompt_version`;
  - PII redaction;
  - grounding va rule∩LLM birlashtirish;
  - eval orqali model tanlash.
- **T3.5** `ai_interpretations` logi (redacted, 30 kunlik retention) va `product_events`. `← T3.4`
- **T3.6** Customer resolver: exact / prefix / trigram, chegaralar. `← T2.4`
- **T3.7** **Decision policy**: toza funksiya, jadval-testlar (intent × resolution × balans × obuna holati). `← T3.3, T3.6, T2.6`
- **T3.8** `pending_operations` (TTL 15 daqiqa) va `conversation_state` state machine. Yangi to‘liq buyruq kelsa eski draft bekor qilinadi. `← T2.1`
- **T3.9** Bot handler'lari va shablonlar (Lotin/Kirill) `← T3.7, T3.8`:
  - Saqlash, O‘zgartirish, Bekor qilish;
  - mijoz tanlash, "Ha, X so‘m", "Boshqa summa";
  - callback'da qisqa draft ID;
  - amaldan keyin tugmalar olib tashlanadi.
- **T3.10** **Commit flow**: callback → draft egasi/TTL/status → qayta validatsiya (membership, obuna, balans) → `LedgerService(idempotency_key=draft_id)`. Balans o‘zgargan bo‘lsa, yangi qoldiq bilan qayta tasdiq so‘raladi. `← T3.9, T2.5`
- **T3.11** Ko‘rish va o‘chirish: VIEW_BALANCE, VIEW_HISTORY (oxirgi N ta yozuv, har birida "🗑 O‘chirish" tugmasi → tasdiq → storno), CREATE_CUSTOMER. `← T3.9, T2.7`
- **T3.12** Tez tugmalar (➕ 💵 👥) — o‘sha draft pipeline'i orqali. `← T3.9`
- **T3.13** Chekka holatlar `← T3.9`:
  - `edited_message`;
  - voice, rasm, stiker;
  - juda uzun input;
  - guruh chat;
  - revoke qilingan staff;
  - EXPIRED biznes.
- **T3.14** Bot integratsion testlari: TT §46 holatlari, AC-01…07, ortiqcha to‘lovni rad etish, o‘chirish. `← T3.10–T3.13`

> **Checkpoint:** T3.14 dan keyin bot MVP sifatida ichki sinovga tayyor (Mini App'siz).

### Phase 4 — Mini App

- **T4.1** API qatlami: initData auth, biznes konteksti, RBAC, zod, `Idempotency-Key`, rate limit, CORS, security header'lar. `← T1.8, T1.9`
- **T4.2** Endpoint'lar `← T4.1, T2.4–T2.8`:
  - `/me`, biznesni almashtirish;
  - `/dashboard`;
  - `/customers` (qidiruv, sort, pagination), `/customers/:id`, `/customers/:id/ledger`;
  - debt/payment uchun preview → commit;
  - `DELETE /entries/:id` (storno);
  - adjustment (owner);
  - staff: list, invite, revoke;
  - `/billing` (owner: holat, muddat, "To‘lash" kontakti).
- **T4.3** Mini App scaffold: React + Vite, Telegram SDK, theme, i18n, API client (idempotency key), error boundary. `← T1.1`
- **T4.4** Ekranlar: Dashboard, mijozlar ro‘yxati, mijoz sahifasi va tarix (o‘chirilganlar chizilgan), nasiya/to‘lov qo‘shish, xodimlar, sozlamalar, obuna holati, biznes switcher. EXPIRED holatda read-only banner. `← T4.2, T4.3`
- **T4.5** Bot ↔ Mini App: menu button, `/menu`'dagi web_app tugma, `startapp` deep-link. `← T4.4, T3.9`
- **T4.6** **Tenant isolation test matritsasi** — barcha route'lar (AC-06). `← T4.2`

### Phase 5 — Billing operatsiyalari

- **T5.1** Superadmin: `/sub <kod>`, `/extend <kod> <oy> [izoh]`, `/expiring` (yaqin kunlarda tugaydiganlar), audit bilan. `← T1.6, T1.9`
- **T5.2** Eslatma cron'i: 3 kun, 1 kun va tugagan kuni. Takror yubormaslik uchun idempotent (`notification_key`). `← T5.1`
- **T5.3** Gating testlari: TRIAL → EXPIRED → `/extend` → ACTIVE; EXPIRED'da yozish bloklanadi, o‘qish ishlaydi; trial'ni ikkinchi marta olib bo‘lmaydi. `← T5.1, T3.10, T4.2`

### Phase 6 — Hardening va production

- **T6.1** Xavfsizlik `← T4.6, T3.14, T5.3`:
  - authz review;
  - initData replay;
  - prompt-injection testlari;
  - `npm audit`;
  - secret rotation tartibi.
- **T6.2** Rate limiting: har bir user uchun xabar/daqiqa, biznes bo‘yicha kunlik Gemini byudjeti, Telegram'ga yuborishda throttler. `← T3.4`
- **T6.3** Observability: metrikalar (latency, webhook lag, Gemini xatolari/fallback, clarification rate), alert'lar. `← T1.4`
- **T6.4** Yuklama testi (k6): AI'siz operatsiyalar p95 < 500 ms; AI p95 < 3 s. `← T4.2, T3.10`
- **T6.5** Backup: kunlik pg_dump, WAL/PITR, shifrlangan offsite nusxa; **tiklash mashqi**, RPO/RTO yoziladi. `← T1.11`
- **T6.6** Maxfiylik: log sanitization tekshiruvi, retention, ma'lumotni o‘chirish tartibi, Privacy Policy va ToS, Gemini pullik tier shartlari. `← T3.5`
- **T6.7** AI eval gate: golden set 500+; prompt/model o‘zgarsa CI eval; **wrong-financial-transaction = 0**. `← T3.1`
- **T6.8** Runbook'lar (deploy, rollback, webhook reset, reconciliation mismatch) va production deploy. `← T6.1–T6.7`

### Phase 7 — Pilot (10–30 biznes)

- **T7.1** Biznes bo‘yicha feature flag'lar (Gemini on/off, chegaralar).
- **T7.2** Funnel analitikasi (TT §41): activation, birinchi tranzaksiyagacha vaqt, completion/clarification/correction rate, DAB, retention 7/30, **trial → pullik konversiya**.
- **T7.3** Haftalik sikl: muvaffaqiyatsiz va tuzatilgan inputlar → anonimlashtirish → golden set → parser/prompt yaxshilanadi.

---

## 4. Kritik yo‘l

```text
D-1,D-2 → T1.1 → T1.3 → T1.6 → T1.8 → T1.9 → T2.1 → T2.5 → T3.7 → T3.10 → T3.14 → T5.x → T6.x → Pilot
                          ↘ T1.7 → T1.10              ↗ T3.3 ← T3.2 ← T2.3
Parallel: NLP (T2.3, T3.1–T3.4) ‖ Ledger (T2.1–T2.9) ‖ Mini App UI (T4.3, mock API bilan)
```

## 5. Acceptance criteria → testlar

| AC              | Tekshiruv                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------- |
| AC-01 Debt      | T3.14: input → tasdiq → aynan 1 ta `DEBT 450000`                                            |
| AC-02 Payment   | T3.14 + T2.9: balans 250000                                                                 |
| AC-03 Full      | T3.7: `CONFIRM_FULL`; tasdiqsiz ledger'da 0 ta yozuv                                        |
| AC-04 Mixed     | T3.1: 3 input → bir xil intent                                                              |
| AC-05 Duplicate | T2.9 + T3.14: takroriy update va ikki marta "Saqlash" → 1 ta yozuv                          |
| AC-06 Tenant    | T2.9 + T4.6 + RLS                                                                           |
| AC-07 Ambiguous | T3.6/T3.7: ≥2 kandidat → `ASK_CUSTOMER`                                                     |
| Q1 Overpay      | T2.9 + T3.14: qarzdan katta to‘lov hech qanday yo‘l bilan yozilmaydi (parallel holatda ham) |
| Q3 Delete       | T2.9: storno, takroriy o‘chirish va balans < 0 holatlari                                    |
| Q6 Billing      | T5.3                                                                                        |
