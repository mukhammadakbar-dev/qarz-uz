# ADR-0002 — Ledger: o‘zgarmaslik, ishora, balans va storno

**Status:** Qabul qilingan (2026-10-07)
**Bog‘liq:** TT §22–24, §27, §29; Reja Q1, Q2, Q3

## Kontekst

Ledger moliyaviy haqiqat manbai. Asosiy tamoyil (TT §50): *LLM noto‘g‘ri tushunishi mumkin, ledger noto‘g‘ri bo‘lishi mumkin emas.*

TT'ga nisbatan qabul qilingan o‘zgarishlar:
1. **§29 (ortiqcha to‘lov ruxsat etiladi)** o‘rniga: ortiqcha to‘lov **hech qachon** yozilmaydi (Q1).
2. **§3.2 (staff faqat o‘z operatsiyalarini ko‘radi)** o‘rniga: staff butun tarixni ko‘radi va yozuvni o‘chira oladi (Q2).
3. **§23 formulasi** `SUM(DEBT) − SUM(PAYMENT) + SUM(ADJUSTMENT)` generated ustun `delta` orqali ifodalanadi (ekvivalent).

## Qaror

### 1. Pul

- `BIGINT`, **butun so‘m**. Tiyin yo‘q. Float hech qayerda ishlatilmaydi.
- Bitta yozuv uchun chegara: `1 ≤ amount ≤ 10 000 000 000` (10 mlrd). Undan katta bo‘lsa **rad etiladi**.
- `≥ 50 000 000` (50 mln) bo‘lsa rad etilmaydi, lekin tasdiqlashda alohida ogohlantirish chiqadi (`WARN_LARGE_AMOUNT`).
- `currency` har bir yozuvda saqlanadi (MVP: `UZS`). Yozuv valyutasi biznes valyutasiga teng bo‘lishi majburiy.

### 2. Yozuv turlari va ishora

| `type` | `amount` | `delta` |
|---|---|---|
| `DEBT` | `> 0` | `+amount` |
| `PAYMENT` | `> 0` | `−amount` |
| `ADJUSTMENT` | `≠ 0` (ishorali) | `amount` |

`delta` generated ustun (`GENERATED ALWAYS AS (CASE …) STORED`). Balans: `SUM(delta)`. Bu TT §8 dagi `PAYMENT −200000` yozuviga ekvivalent: ilovada va hisobotlarda `delta` ko‘rsatiladi.

### 3. Invariant: `balance ≥ 0`

- Hech bir holatda mijoz balansi manfiy bo‘lmaydi.
- Uch qatlam bilan majburlanadi:
  1. **Decision policy:** foydalanuvchiga rad sababi tushunarli aytiladi (`REJECT_OVERPAY`, `REJECT_NO_DEBT`).
  2. **LedgerService:** customer qatori `FOR UPDATE` bilan bloklangandan keyin yangi balans hisoblanadi, `< 0` bo‘lsa `OverpaymentError`.
  3. **DB:** `customer_balances.balance BIGINT NOT NULL CHECK (balance >= 0)`. Proyeksiya ledger bilan **bitta tranzaksiyada** yangilanadi, shuning uchun ilova xato qilsa ham tranzaksiya ROLLBACK bo‘ladi.
- Natijalar:
  - qarzdan katta to‘lov rad etiladi;
  - qarzi 0 bo‘lgan yoki yangi mijozga to‘lov rad etiladi;
  - ikki staff parallel to‘lov yozsa va yig‘indisi qarzdan oshsa, ikkinchisi rad etiladi;
  - keyingi to‘lovlar bor DEBT'ni o‘chirish, balansni manfiy qilsa, rad etiladi.

### 4. O‘zgarmaslik

- App DB roliga `ledger_entries` ustida faqat `INSERT` va `SELECT` beriladi.
- Qo‘shimcha himoya: `BEFORE UPDATE OR DELETE` trigger istisno ko‘taradi (superuser xatosiga qarshi).
- `audit_logs` ham append-only (xuddi shu usul).

### 5. Storno ("o‘chirish")

Staff va owner yozuvni "o‘chira oladi" (Q2). Texnik jihatdan bu **teskari yozuv**:

```text
original:  DEBT        amount=450000  delta=+450000
storno:    ADJUSTMENT  amount=-450000 delta=-450000  reverses_entry_id=<original.id>
```

Qoidalar:
- `reverses_entry_id` ustida `UNIQUE` indeks: bitta yozuv faqat bir marta o‘chiriladi.
- Storno yozuvining o‘zini o‘chirib bo‘lmaydi (`reverses_entry_id IS NOT NULL` bo‘lsa rad).
- `amount_storno = −original.delta`, shu sababli `PAYMENT`ni o‘chirish `+`, `DEBT`ni o‘chirish `−` yozuv bo‘ladi.
- O‘chirish natijasida balans `< 0` bo‘lsa rad etiladi (3-band). Xabar: "Avval keyingi to‘lovlarni o‘chiring".
- Vaqt cheklovi yo‘q. Sabab ixtiyoriy (`description`).
- Tarixda original yozuv "o‘chirildi — {kim}, {qachon}" belgisi bilan ko‘rsatiladi. Balans hisobida original va storno juftligi o‘zaro yo‘qoladi.
- Kim o‘chirgani `created_by`, audit va `metadata.reason` ichida saqlanadi.
- Staff o‘chirsa, owner'ga Telegram xabar yuboriladi (biznes sozlamasida o‘chirib qo‘yish mumkin).

### 6. Tahrirlash ("O‘zgartirish")

- Saqlangan yozuvni tahrirlash = storno + yangi yozuv, **bitta tranzaksiyada**. `balance ≥ 0` tekshiruvi yakuniy natijaga qo‘llanadi.
- Draft (hali saqlanmagan) tahrirlash ledger'ga ta'sir qilmaydi.

### 7. Qo‘lda ADJUSTMENT

- Faqat OWNER. `description` majburiy. Natijaviy balans `≥ 0` bo‘lishi shart.

### 8. Vaqt

- `created_at` (server vaqti) va `occurred_at` (voqea sanasi) alohida.
- `occurred_at ∈ [now − 365 kun, now]`. Kelajak sana rad etiladi.
- **Tarix tartibi va "qoldiq" (running balance) `id` / `created_at` tartibida** hisoblanadi, `occurred_at` bo‘yicha emas. Shunda orqaga sanalangan yozuv o‘tgan qoldiqlarni "manfiy" qilib ko‘rsatmaydi. `occurred_at` faqat ko‘rsatiladigan sana.
- "Bugun" va "bugungi operatsiyalar" `businesses.timezone` (`Asia/Tashkent`) bo‘yicha hisoblanadi.

### 9. Proyeksiya va reconciliation

- `customer_balances(customer_id PK, business_id, balance, last_entry_id, updated_at)` ledger insert bilan bitta tranzaksiyada yangilanadi.
- Haqiqat manbai ledger. Kunlik job har bir mijoz uchun `SUM(delta)` ni proyeksiya bilan solishtiradi, farq bo‘lsa alert beradi (avtomatik tuzatilmaydi).

### 10. Konkurentlik

- Har bir moliyaviy tranzaksiya `SELECT … FROM customers WHERE id=$1 AND business_id=$2 FOR UPDATE` bilan boshlanadi.
- Lock tartibi bitta mijoz bilan cheklanadi, shuning uchun deadlock xavfi yo‘q. Ko‘p mijozli amal MVP'da mavjud emas.

### 11. Mijoz hayot sikli

- Mijoz **o‘chirilmaydi**, arxivlanadi (`status = ARCHIVED`). Faqat OWNER, faqat balans `0` bo‘lganda.
- Arxivlangan mijoz resolver natijalaridan chiqariladi. Qaytarish (unarchive) faqat OWNER.
- `customers(business_id, normalized_name)` ustida unique **emas**: bir xil ismli mijozlar mumkin, farqlash `label` orqali (TT §12).

### 12. Tenant

- `ledger_entries`, `customers`, `customer_balances` hammasida `business_id`. `customer_id` va `business_id` mosligi composite FK bilan majburlanadi: `FOREIGN KEY (business_id, customer_id) REFERENCES customers (business_id, id)`.
- RLS policy ADR-0006 da.

## Ko‘rib chiqilgan muqobillar

- **Manfiy balansga (avans) ruxsat:** Q1 bo‘yicha rad etildi.
- **Yozuvni to‘g‘ridan-to‘g‘ri o‘chirish yoki UPDATE:** TT §24 ga zid, audit izini yo‘qotadi.
- **Faqat hisoblangan balans (proyeksiyasiz):** har so‘rovda `SUM` qimmat va `CHECK` bilan majburlab bo‘lmaydi.
- **Running balance `occurred_at` bo‘yicha:** orqaga sanalangan yozuvlar tarixni chalkashtiradi.

## Oqibatlar

- Hamma yozuv yo‘llari (`bot`, `miniapp`, `storno`, `adjustment`) bitta `LedgerService` ichidan o‘tadi.
- Test talablari: 50 parallel to‘lov, dublikat idempotency kaliti, trigger tekshiruvi, `fast-check` bilan `balance == SUM(delta) ≥ 0`, storno chekka holatlari.
