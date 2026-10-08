# ADR-0008 — Superadmin paneli va ommaviy xabar

**Status:** Qabul qilingan (2026-10-08)
**Bog‘liq:** ADR-0005 (superadmin qoidasini o‘zgartiradi), ADR-0006, ADR-0007

## Kontekst

ADR-0005 da superadmin faqat billing metama'lumotini ko‘rardi (nom, kod, muddat, owner), mijoz va qarzlarni ko‘ra olmasdi. Mahsulot egasi (2026-10-08) platformani boshqarish uchun to‘liqroq panel so‘radi: barcha do‘konlar va ularning ma'lumotlarini ko‘rish, obunani boshqarish, do‘kon egalariga va xodimlariga ommaviy xabar yuborish.

## Qaror

### Ruxsatlar

- Superadmin: `SUPERADMIN_TELEGRAM_IDS` dagi Telegram akkauntlar. Kirish mavjud Telegram autentifikatsiyasi orqali, alohida parol yo‘q.
- **Ko‘radi:** do‘konlar ro‘yxati va statistika, ega va a'zolar, obuna va to‘lovlar, mijozlar ro‘yxati, qarzlar va tarix.
- **Qila oladi:** obunani uzaytirish (Idempotency-Key bilan), do‘konni bloklash va blokdan chiqarish, ommaviy xabar yuborish.
- **Qila olmaydi:** do‘kon nomidan qarz, to‘lov, o‘chirish yoki mijoz yaratish. Do‘kon ichini o‘qish ilova pool'i va RLS orqali (`app.business_id` = tanlangan do‘kon) amalga oshadi. Yozuv servislari a'zolikni DB'dan qayta tekshiradi (`withVerifiedBusiness`), superadmin a'zo bo‘lmagani uchun har qanday yozuv rad etiladi.
- Superadmin bo‘lmagan foydalanuvchiga `/api/admin/*` yo‘llari **404** qaytaradi (panel borligi bilinmaydi), tokensiz so‘rov 401.

### Audit va maxfiylik

- Har bir do‘kon tafsilotini, mijozlar ro‘yxatini va mijoz tarixini ochish `audit_logs` ga yoziladi (`admin.business.view`, `admin.customers.view`, `admin.ledger.view`; actor = superadmin).
- Uzaytirish (`billing.extend`), bloklash (`business.suspend`/`business.unsuspend`) va ommaviy xabar (`broadcast.create`) ham audit'ga yoziladi.
- Maxfiylik siyosatida (T6.6) platforma administratori do‘kon ma'lumotlarini ko‘rishi mumkinligi ochiq yozilishi **shart**.

### Bloklash

- `businesses.suspended_at` / `suspended_reason`. Bloklangan do‘kon EXPIRED kabi faqat o‘qiladi: `assertWritable` `SubscriptionExpiredError({ reason: 'SUSPENDED' })` tashlaydi, xabar matni alohida.
- Ilova roliga `businesses` jadvalidan faqat `name` va `notify_owner_on_delete` ustunlarini yangilash ruxsati qoldi, ega o‘zini blokdan chiqara olmaydi.
- Bloklash, blokdan chiqarish va uzaytirishda egaga bot orqali xabar boradi (best-effort).

### Ommaviy xabar

- Auditoriya: obuna holati (TRIAL / ACTIVE / EXPIRED, bir nechtasi birga) va ixtiyoriy ravishda xodimlar.
- Yuborishdan oldin aniq qabul qiluvchilar soni ko‘rsatiladi va tasdiq so‘raladi. Bir bosish = bitta Idempotency-Key.
- Qabul qiluvchilar yaratilish paytida `broadcast_recipients` ga yoziladi (bir odam bir marta). Yuboruvchi faqat `PENDING` qatorlarni oladi, natijani (`SENT` / `BLOCKED` / `FAILED`) shu qatorga yozadi. Jarayon qayta ishga tushsa davom etadi, hech kimga ikki marta yuborilmaydi.
- Tezlik: xabarlar orasida ~50 ms (Telegram cheklovi ~30/soniya), 429 da `retry_after` kutiladi, 403 (bot bloklangan) — `BLOCKED`.
- Matn oddiy matn sifatida yuboriladi (`parse_mode` yo‘q), 1–4000 belgi.

## Oqibatlar

- ADR-0005 dagi "Superadmin biznes ma'lumotlarini ko‘ra olmaydi" qoidasi shu ADR bilan almashtirildi.
- Panel faqat `SYSTEM_DATABASE_URL` sozlangan bo‘lsa ishlaydi (do‘konlararo o‘qish `nasiya_system` orqali).
- Testlar: `apps/server/src/api/admin.int.test.ts` (kirish, RLS, audit, idempotentlik, bloklash, broadcast), `apps/miniapp/src/pages/admin/admin.test.tsx`.
