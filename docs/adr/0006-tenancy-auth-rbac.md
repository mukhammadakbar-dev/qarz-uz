# ADR-0006 — Tenant isolation, autentifikatsiya va RBAC

**Status:** Qabul qilingan (2026-10-07)
**Bog‘liq:** TT §26, §34, §36; AC-06; Q2

## Kontekst

Qarz ma'lumotlari moliyaviy va maxfiy. Business A ma'lumotlari Business B foydalanuvchilariga hech qanday holatda ko‘rinmasligi yoki o‘zgarmasligi kerak. Klient yuborgan `business_id`, `user_id` va `customer_id` ga ishonib bo‘lmaydi (TT §36).

## Qaror

### 1. Autentifikatsiya

**Bot:**

- Webhook `X-Telegram-Bot-Api-Secret-Token` sarlavhasi bilan tekshiriladi (doimiy vaqtli taqqoslash). Mos kelmasa `401`, javobsiz.
- Foydalanuvchi `message.from.id` / `callback_query.from.id` dan olinadi. Matn ichidagi ID ga ishonilmaydi.
- Faqat `private` chat. Guruh va kanal update'lari o‘tkazib yuboriladi.
- `allowed_updates = ["message", "callback_query", "my_chat_member"]`.

**Mini App:**

- Klient `initData` yuboradi. Server uni bot tokenidan olingan HMAC bilan tekshiradi, `auth_date` ≤ 24 soat (sozlanadi).
- Muvaffaqiyatda server qisqa muddatli (masalan 1 soat) session token beradi. Token faqat `user_id` ni o‘z ichiga oladi. **Biznes va rol token ichida emas**, har so‘rovda DB'dan o‘qiladi.
- Token cookie'da emas, `Authorization: Bearer`. CORS faqat Mini App domeniga.

### 2. Aktiv biznes

- Bir foydalanuvchi bir nechta biznesda a'zo bo‘lishi mumkin (`business_members`).
- Aktiv biznes: foydalanuvchi tanlovi (`users.active_business_id` yoki so‘rovdagi `X-Business-Id`). Bu **faqat selector**. Har so‘rovda `ACTIVE` a'zolik tekshiriladi, topilmasa `403`.
- Bitta biznes bo‘lsa avto tanlanadi.

### 3. Server-side authorization

Har bir so‘rov: `identity → membership(user, business, status=ACTIVE) → permission → subscription gating → servis`.

- Membership va rol **keshlanmaydi** (yoki ≤ 5 s). Revoke darhol kuchga kiradi (TT §46: staff access revoke).
- `REVOKED` yoki biznesdan chiqarilgan foydalanuvchi: bot "Sizda ruxsat yo‘q" deydi, draft'lari `CANCELLED`, ochiq callback'lar rad etiladi.

### 4. RBAC

Permission'lar kodda (`permissions.ts`) belgilangan, rol → permission to‘plami. Keyinchalik DB'ga ko‘chirish mumkin (TT §3.2).

| Permission                                            | OWNER | STAFF |
| ----------------------------------------------------- | :---: | :---: |
| `customer.create`, `customer.update`, `customer.view` |   ✔   |   ✔   |
| `ledger.debt`, `ledger.payment`                       |   ✔   |   ✔   |
| `ledger.history.view` (butun tarix)                   |   ✔   |   ✔   |
| `ledger.entry.delete` (storno)                        |   ✔   |   ✔   |
| `ledger.adjustment`                                   |   ✔   |   —   |
| `customer.archive`, `customer.unarchive`              |   ✔   |   —   |
| `staff.manage` (taklif, revoke)                       |   ✔   |   —   |
| `business.settings`, `billing.view`                   |   ✔   |   —   |

OWNER'ni o‘zi o‘chira olmaydi va biznesda kamida bitta ACTIVE OWNER qoladi.

### 5. Staff taklifi

- Owner taklif havolasini yaratadi: `t.me/<bot>?start=inv_<token>`.
- Token tasodifiy (≥128 bit), DB'da faqat **hash** saqlanadi, bir martalik, TTL 48 soat, rol oldindan belgilangan.
- Ishlatilganda `used_by`, `used_at` yoziladi. Qayta ishlatish rad etiladi.
- Foydalanuvchi allaqachon a'zo bo‘lsa, idempotent.
- Deaktivatsiya: `status = REVOKED`, `revoked_at`. Qayta taklif qilinsa, yangi token orqali `ACTIVE` ga qaytadi (eski yozuvlar `created_by` bilan saqlanadi).

### 6. Tenant isolation: ikki qatlam

**Qatlam 1: ilova.** Hamma repository funksiyalari `businessId`'ni **majburiy** parametr sifatida oladi. `businessId` tipi branded (`BusinessId`), faqat membership-tekshirilgan kontekstdan olinadi. SQL'da har doim `WHERE business_id = $1`.

**Qatlam 2: PostgreSQL RLS.**

- Barcha tenant jadvallarida `ENABLE` va `FORCE ROW LEVEL SECURITY`.
- Policy: `USING (business_id = current_setting('app.business_id', true)::uuid)`.
- Har tranzaksiya boshida `SET LOCAL app.business_id = $1`. O‘rnatilmasa, hech narsa ko‘rinmaydi (fail-closed).
- `app` roli `BYPASSRLS` huquqiga ega emas. `migrator` va backup rollari alohida.
- Cross-tenant ishlar (reconciliation, eslatmalar, billing admin) alohida `system` servis roli orqali, aniq belgilangan yo‘llar bilan.

**Composite FK:** `(business_id, customer_id)` juftligi `customers(business_id, id)` ga ulanadi, shuning uchun boshqa biznes mijoziga yozuv DB darajasida ham mumkin emas.

### 7. Rate limiting va suiiste'mol

- Foydalanuvchi bo‘yicha xabar/daqiqa, IP va foydalanuvchi bo‘yicha Mini App so‘rovlari.
- Biznes bo‘yicha kunlik Gemini byudjeti, oshsa faqat `RuleProvider` ishlaydi.
- Telegram'ga yuborishda throttler (≈30 msg/s global, ≈1 msg/s per chat).

### 8. Audit

`audit_logs` (append-only): kim (`actor_user_id`), qaysi biznes, nima (`action`), qaysi obyekt, `before`/`after`, vaqt, `request_id`. Yoziladi: ledger yozuvlari va storno, mijoz yaratish/tahrirlash/arxivlash, staff taklif/revoke, billing, sozlamalar o‘zgarishi.

### 9. Maxfiylik

- Prod loglarida xabar matni va summalar yozilmaydi (`pino` redaction + `request_id`, `update_id`, `business_id`, `user_id`, `ledger_entry_id`).
- Telefon raqamlar logda maskalanadi.
- Backup shifrlanadi. Retention va o‘chirish siyosati T6.6 da.

## Ko‘rib chiqilgan muqobillar

- **Biznes/rol JWT ichida:** revoke kechikadi (TT §46 ga zid).
- **Faqat ilova darajasidagi filtr:** bitta unutilgan `WHERE` butun tenantni ochadi; RLS "fail-closed" himoya beradi.
- **Har biznes uchun alohida schema/DB:** MVP uchun ortiqcha operatsion yuk.

## Oqibatlar

- Test matritsasi (T4.6): har bir route'ni "boshqa biznes ID'si bilan" avtomatik tekshiradi (AC-06).
- Har bir tranzaksiya `SET LOCAL` bilan boshlanadi, buni yagona `withTenant(businessId, fn)` yordamchisi ta'minlaydi.
