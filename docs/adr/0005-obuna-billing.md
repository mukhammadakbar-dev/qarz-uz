# ADR-0005 — Obuna (trial va qo‘lda to‘lov)

**Status:** Qabul qilingan (2026-10-07)
**Bog‘liq:** Reja Q6, D-a, D-d

## Kontekst

TT'da obuna yo‘q, lekin mahsulot pullik bo‘ladi: **14 kun bepul trial**, keyin **29 000 so‘m/oy**. Boshida to‘lov **qo‘lda**: owner adminga Telegramda yozadi, to‘laydi, admin obunani uzaytiradi. Onlayn gateway (Click va boshqalar) keyingi bosqich.

## Qaror

### Ma'lumotlar

```text
subscriptions         (business_id PK, trial_ends_at, paid_until NULL, updated_at)
subscription_payments (id, business_id, amount BIGINT, months INT, period_from, period_to,
                       recorded_by, note, created_at)        -- append-only
users.trial_used_at   -- trial bir marta beriladi
businesses.short_code -- masalan TD-4F7K, owner adminga shuni aytadi
```

### Holat (hisoblanadi, saqlanmaydi)

| Shart | Holat |
|---|---|
| `now < trial_ends_at` | `TRIAL` |
| `now < paid_until` | `ACTIVE` |
| aks holda | `EXPIRED` |

`ACTIVE` ham `TRIAL` ham ruxsat beradi. Ikkalasi tugagan bo‘lsa `EXPIRED`.

### Trial qoidasi

- Biznes yaratilganda `trial_ends_at = now + 14 kun`, va `users.trial_used_at = now`.
- Foydalanuvchi (Telegram user) ikkinchi biznes ochsa, yangi trial **berilmaydi** (`trial_ends_at = now`, ya'ni darhol `EXPIRED`). Staff sifatida qo‘shilish trial'ga ta'sir qilmaydi.
- `short_code` tasodifiy, 4–6 belgili, o‘qishda chalkash belgilar (`0/O`, `1/I`) olib tashlangan alifbo.

### EXPIRED (read-only)

- Ko‘rish ishlaydi: mijozlar, tarix, qidiruv, dashboard, balans so‘rovlari.
- Bloklanadi: yangi nasiya, to‘lov, o‘chirish (storno), tahrirlash, adjustment, yangi mijoz, yangi staff taklifi.
- Tekshiruv **LedgerService va tegishli servislar ichida, tranzaksiyada** bajariladi (UI'da emas). Bot `BLOCKED_SUBSCRIPTION` action'ini qaytaradi va "To‘lash" tugmasi (admin kontakti) ko‘rsatadi.
- Ma'lumot saqlanadi va o‘chirilmaydi. To‘lov qilinsa, hamma narsa avvalgidek davom etadi.

### Uzaytirish

```text
new_paid_until = max(now, paid_until ?? now, trial_ends_at) + N oy
```

`N oy` kalendar oyi (`+ interval 'N month'`). `subscription_payments` ga qator yoziladi va audit qilinadi. Narx (`SUBSCRIPTION_PRICE_UZS=29000`) sozlamada, kodda hardcode qilinmaydi. Yozuvdagi `amount` — haqiqatda olingan summa.

### Admin (superadmin)

- `SUPERADMIN_TELEGRAM_IDS` (env, vergul bilan). Faqat shu foydalanuvchilar admin buyruqlarini ishlata oladi.
- Buyruqlar: `/sub <kod>` (holat), `/extend <kod> <oy> [izoh]`, `/expiring` (7 kun ichida tugaydiganlar).
- Superadmin **biznes ma'lumotlarini (mijoz, qarz) ko‘ra olmaydi**. U faqat billing metama'lumotini ko‘radi (nom, kod, muddat, owner).
- Har bir buyruq audit'ga yoziladi (`actor`, `business`, `before`, `after`).
- `/extend` idempotent emas (takroriy chaqiruv yana uzaytiradi). Shuning uchun natija xabarida aniq yangi sana ko‘rsatiladi va bot tasdiq tugmasi so‘raydi.

### Eslatmalar

- Owner'ga trial/obuna tugashiga **3 kun** va **1 kun** qolganda, hamda tugagan kuni.
- Takror yubormaslik uchun `notification_key = {business_id}:{kind}:{paid_until|trial_ends_at}` ga unique.
- Eslatmada "To‘lash" tugmasi admin kontaktiga (`SUPPORT_TELEGRAM_USERNAME`) olib boradi.

## Keyinga qoldirilgan

- Onlayn to‘lov gateway'lari (Click/Payme).
- Narx rejalari, promo, chegirmalar.
- Fakturalar va hisobotlar.

## Oqibatlar

- Billing logikasi ledger'dan alohida modul (`billing`), lekin ledger yozish yo‘li uni so‘raydi (`assertWritable(businessId)`).
- Testlar: `TRIAL → EXPIRED → /extend → ACTIVE`; EXPIRED'da yozish bloklanadi, o‘qish ishlaydi; ikkinchi trial berilmaydi.
