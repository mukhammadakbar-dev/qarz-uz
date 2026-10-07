# ADR-0003 — Idempotentlik, draft hayot sikli va tartib

**Status:** Qabul qilingan (2026-10-07)
**Bog‘liq:** TT §27, §28; AC-05; ADR-0002

## Kontekst

Telegram bir xil update'ni qayta yuborishi mumkin (webhook retry). Foydalanuvchi "Saqlash"ni ikki marta bosishi, tarmoq uzilib qayta so‘rov ketishi, ikki staff bir vaqtda yozishi mumkin. Har holatda ledger'da **bitta** yozuv bo‘lishi kerak.

## Qaror

### Asosiy g‘oya

Moliyaviy yozuv hech qachon matnli xabardan **to‘g‘ridan-to‘g‘ri** tug‘ilmaydi. U faqat **draft** (`pending_operations`) tasdiqlanganda tug‘iladi. Draft ID yozuvning idempotentlik kaliti bo‘ladi.

```text
matnli xabar → (yangi draft yaratiladi, pul yozilmaydi)
[Saqlash] callback → draft PENDING→COMMITTED + ledger insert (bitta tranzaksiya)
```

Natija: matnli xabar qayta ishlansa ham, faqat ortiqcha draft paydo bo‘ladi (xavfsiz). Pul faqat tugma orqali va draft bo‘yicha bir marta yoziladi.

### Uch qatlam

1. **Update dedupe (best-effort).** `processed_updates(update_id PK, received_at)` ga `INSERT … ON CONFLICT DO NOTHING`. Yozuv yaratilmasa (conflict) update o‘tkazib yuboriladi va `200` qaytariladi. Bu optimizatsiya, moliyaviy kafolat emas.
2. **Moliyaviy kafolat.** `ledger_entries UNIQUE (business_id, idempotency_key)`. `idempotency_key = draft_id` (bot) yoki `Idempotency-Key` (Mini App). Takroriy urinish `unique_violation` oladi va avvalgi natija qaytariladi ("✓ allaqachon saqlangan").
3. **Mini App so‘rovlari.** `idempotency_keys(key, user_id, request_hash, response, created_at)`:
   - kalit bor va `request_hash` bir xil: saqlangan javob qaytariladi;
   - kalit bor, lekin `request_hash` boshqa: `422 IDEMPOTENCY_KEY_REUSED`;
   - 7 kundan keyin tozalanadi.

### Draft hayot sikli

```text
PENDING ──[Saqlash]──────▶ COMMITTED
   │ ──[Bekor qilish]────▶ CANCELLED
   │ ──[TTL 15 daq]──────▶ EXPIRED
   └ ──[yangi buyruq]────▶ SUPERSEDED
```

- O‘tish faqat `UPDATE pending_operations SET status=$new WHERE id=$1 AND status='PENDING' RETURNING …` bilan. 0 qator qaytsa, boshqa jarayon allaqachon o‘tkazgan.
- Faqat draftni yaratgan foydalanuvchi uni tasdiqlay oladi (`user_id` mos kelishi shart). Boshqa user bosganida "Bu tasdiq sizniki emas".
- `payload` o‘zgarmas: tasdiqlanayotgan summa va mijoz draft'da saqlangan qiymat. Callback ma'lumotida summa yoki mijoz **yo‘q**, faqat qisqa draft ID va amal (`d:<id>:ok|edit|no`), Telegram'ning 64 bayt limiti ichida.
- Foydalanuvchi yangi to‘liq buyruq yozsa, eski PENDING draft `SUPERSEDED` bo‘ladi va foydalanuvchiga aytiladi. Eski tugmalar ishlamaydi ("Bu so‘rov eskirgan").
- Bir chatda bir vaqtda faqat bitta faol draft yoki so‘rov (`conversation_state`).

### Commit tranzaksiyasi (tartib)

```text
BEGIN
  1. draft: PENDING → COMMITTED (0 qator bo‘lsa: idempotent javob qaytarish, tugatish)
  2. membership ACTIVE tekshiruvi (user_id, business_id)
  3. obuna holati tekshiruvi (EXPIRED bo‘lsa BLOCKED_SUBSCRIPTION)
  4. customer FOR UPDATE (business_id bilan)
  5. mijoz ACTIVE (arxivlanmagan)
  6. balans qayta o‘qiladi; draft.expected_balance bilan solishtiriladi
  7. invariantlar (amount chegaralari, balance ≥ 0, valyuta)
  8. ledger insert (idempotency_key = draft_id)
  9. customer_balances yangilanadi
 10. audit_logs
COMMIT (xatoda ROLLBACK, draft PENDING holatiga qaytadi)
```

**Eskirgan qoldiq qoidasi:** 6-qadamda joriy balans draft'dagi `expected_balance`dan farq qilsa (masalan, ikkinchi staff oraliqda yozgan), yozuv **yaratilmaydi**. Foydalanuvchiga yangi qoldiq bilan qayta tasdiq so‘raladi (yangi draft). Sabab: tasdiq oynasida ko‘rsatilgan "Qoldiq" eskirgan.

### Tartib

- Bir chat ichida update'lar **ketma-ket** ishlanadi. MVP'da jarayon ichidagi `KeyedMutex` (bitta PM2 jarayoni, ADR-0001); ikkinchi instance qo‘shilganda `pg_advisory_xact_lock(hash(chat_id))` ga o‘tiladi. Navbatga kirish dedupe'dan oldin sinxron bajariladi, shuning uchun tartib chatga kelish tartibiga teng. Shunda tez ketma-ket yozilgan xabarlar ("Murodga yoz", "100 ming") to‘g‘ri tartibda ishlanadi.
- Webhook handler tezkor javob beradi. LLM chaqiruvi chat lock ichida, lekin 3 s timeout bilan.

### Hisob-kitob xatolari bo‘yicha

- Telegram'ga javob yuborish muvaffaqiyatsiz bo‘lsa ham ledger yozuvi qoladi. Foydalanuvchi qayta "Saqlash"ni bossa, idempotent javob ("✓ saqlangan") chiqadi.

## Ko‘rib chiqilgan muqobillar

- **Kalit sifatida `update_id`:** matnli xabar (draft yaratuvchi) va tugma (commit) alohida update'lar, `update_id` yagona moliyaviy operatsiyani aniqlay olmaydi.
- **Redis dedupe:** qo‘shimcha infratuzilma; DB unique constraint kuchliroq va yetarli.
- **Draft'siz bevosita yozish (yuqori ishonchda):** TT §16 ruxsat berar edi, lekin Q-qaror: hamma yozuv tasdiqlanadi.

## Oqibatlar

- AC-05 testi: bir xil update 2 marta + "Saqlash" 2 marta + parallel 10 ta callback, ledger'da aniq 1 yozuv.
- Draft va conversation holati DB'da, shuning uchun jarayon qayta ishga tushsa ham yo‘qolmaydi.
