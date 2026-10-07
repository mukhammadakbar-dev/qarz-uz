# ADR-0004 — Interpretatsiya pipeline, Gemini va AI xavfsizligi

**Status:** Qabul qilingan (2026-10-07)
**Bog‘liq:** TT §6, §12–17, §18–20, §39, §42; Reja §1.6; Q4

## Kontekst

Foydalanuvchi qarzni erkin matnda yozadi (Lotin, Kirill, aralash). AI faqat "foydalanuvchi nimani nazarda tutdi?" savoliga javob beradi. "Buni bajarish mumkinmi?" savoliga backend deterministik javob beradi. Eng muhim metrika: **wrong financial transaction rate = 0**.

## Qaror

### 1. Pipeline

```text
xabar
 → [1] Normalize
 → [2] RuleProvider (deterministik)        ┐ parallel
 → [3] PII redaction → GeminiProvider      ┘
 → [4] Birlashtirish + grounding → StructuredIntent
 → [5] CustomerResolver (DB, deterministik)
 → [6] DecisionPolicy (toza funksiya) → Action
 → draft yoki savol yoki rad  (ledger'ga faqat ADR-0003 orqali)
```

State javoblari (`100 ming`, `Birinchisi`, tugma bosish) `conversation_state` bo‘lsa, LLM'siz, deterministik qayta ishlanadi.

### 2. Normalize (`packages/shared`)

Yagona funksiya: interpreter, resolver, qidiruv va `customers.normalized_name` uchun.

1. Unicode NFC.
2. Apostrof variantlari (`ʻ ʼ ‘ ’ ` ´`va h.k.) bitta ASCII`'` ga.
3. Kirill → Lotin transliteratsiya (o‘zbek kirill alifbosi):
   `а→a б→b в→v г→g д→d е→e (so‘z boshida ye) ё→yo ж→j з→z и→i й→y к→k л→l м→m н→n о→o п→p р→r с→s т→t у→u ф→f х→x ц→ts ч→ch ш→sh ъ→' ы→i э→e ю→yu я→ya ў→o' қ→q ғ→g' ҳ→h`
4. Lowercase.
5. Ketma-ket bo‘shliqlar bitta bo‘shliqqa. Tashqi emoji va tinish belgilari ajratiladi (summa ichidagi `.` va `,` saqlanadi).

`normalized_name` = ismning shu normalize qilingan ko‘rinishi. `Мурод`, `MUROD`, `murod` hammasi `murod`.

### 3. StructuredIntent

```ts
type Intent =
  | 'CREATE_DEBT'
  | 'CREATE_PAYMENT'
  | 'VIEW_CUSTOMER_BALANCE'
  | 'VIEW_CUSTOMER_HISTORY'
  | 'CREATE_CUSTOMER'
  | 'UNKNOWN';

type AmountKind = 'ABSOLUTE' | 'FULL' | 'FRACTION' | 'NONE';

interface StructuredIntent {
  intent: Intent;
  customer: string | null; // normalizatsiyalangan ism (qo‘shimchasiz)
  amount: number | null; // faqat ABSOLUTE da, butun so‘m
  amount_kind: AmountKind;
  fraction: [number, number] | null; // faqat FRACTION da, masalan [1, 2]
  date_offset_days: number; // 0 = bugun, -1 = kecha; faqat ≤ 0
  phone?: string; // faqat RuleProvider chiqaradi
  confidence: { intent: number; customer: number; amount: number; date: number }; // 0..1
}
```

- `phone` faqat rule parser tomonidan ajratiladi, LLM'ga hech qachon yuborilmaydi.
- `FULL` va `FRACTION` da `amount` har doim `null`. Aniq summani decision policy joriy balansdan hisoblaydi. AI summani **o‘ylab topmaydi**.

### 4. Provider abstraksiyasi (TT §39)

```ts
interface AIProvider {
  readonly name: string;
  readonly version: string; // model / prompt versiyasi
  interpret(msg: NormalizedMessage, ctx: InterpretContext): Promise<StructuredIntent>;
}
```

- `RuleProvider`: deterministik, har doim mavjud.
- `GeminiProvider`: asosiy LLM.
- Keyingi: `QwenProvider` / local (interfeys o‘zgarmaydi).
- `InterpretContext` faqat til sozlamasi va ixtiyoriy oldingi `conversation_state` turini o‘z ichiga oladi. **Mijozlar ro‘yxati, balans yoki DB ma'lumoti LLM'ga berilmaydi.**

### 5. GeminiProvider

- SDK: `@google/genai`. `responseMimeType: application/json`, `responseSchema` (yuqoridagi intent enum), `temperature: 0`.
- Prompt'da Lotin, Kirill va aralash yozuvdagi few-shot misollar, shuningdek `UNKNOWN`ga olib boruvchi misollar. `prompt_version` har bir chaqiruvda log qilinadi.
- Model nomi `GEMINI_MODEL` env orqali. Modelni **golden set eval natijasi** tanlaydi (aniqlik ustuvor, narx ikkinchi).
- Timeout 3 s, 1 marta retry, circuit breaker (ketma-ket xatolarda 60 s "ochiq"). Ochiq paytda faqat `RuleProvider` ishlaydi.
- **Pullik tier** ishlatiladi (bepul tier shartlarida kontent mahsulotni yaxshilashga ishlatilishi mumkin). Provayder shartlari T6.6 da tekshiriladi.
- LLM chiqishi `zod` bilan validatsiya qilinadi. Noto‘g‘ri tuzilma = `UNKNOWN`.

### 6. PII redaction (LLM'ga yuborishdan oldin)

| Nima                                                                                                   | Qanday                      |
| ------------------------------------------------------------------------------------------------------ | --------------------------- |
| Telefon raqam: `+998…` / `998…` prefiksi bilan, yoki `XX XXX XX XX` kabi bo‘shliq/tire guruhlari bilan | `<PHONE>` ga almashtiriladi |
| Karta raqami (13–19 raqam, Luhn)                                                                       | `<CARD>` ga almashtiriladi  |
| Email, URL                                                                                             | `<REDACTED>`                |

- Ism va summa yuboriladi (Q4).
- Redaction **summalarni buzmasligi shart**: `900 000`, `1 200 000`, `50000`, `1.200.000` va prefiksiz oddiy 9 xonali son (`900000000`) telefon deb tanilmaydi. Oxirgisi 900 mln summa sifatida talqin qilinadi va baribir `WARN_LARGE_AMOUNT` + tasdiqdan o‘tadi. Buni test va golden set (`redaction-safety` teglari) tasdiqlaydi.
- Telegram `username` va `first_name` LLM'ga yuborilmaydi.

### 7. Birlashtirish: Rule ∩ LLM

| Rule                                  | LLM     | Natija                                                         |
| ------------------------------------- | ------- | -------------------------------------------------------------- |
| Intent, mijoz va summa bir xil        | bir xil | **High** confidence                                            |
| Rule aniq, LLM `UNKNOWN`/xato/timeout | —       | Rule natijasi, **Medium** (savol yoki tasdiq qat'iyroq)        |
| Rule `UNKNOWN`, LLM aniq              | —       | LLM natijasi, faqat grounding o‘tsa; aks holda `UNKNOWN`       |
| Intent yoki summa **farq qiladi**     | —       | **Low**: clarification (`ASK_*`), hech narsa taxmin qilinmaydi |

### 8. Grounding (LLM chiqishini asosga tekshirish)

LLM natijasi quyidagilar bajarilsa qabul qilinadi:

- `amount` matndan rule parser topgan summalar to‘plamidan biri bo‘lishi shart. LLM "o‘ylab chiqargan" summa rad etiladi.
- `customer` normalizatsiyalangan matnning qismi (qo‘shimchasiz) bo‘lishi shart.
- `date_offset_days ≤ 0` va `≥ −365`.
- `FULL` / `FRACTION` faqat matnda mos ibora bo‘lsa (`qarzini`, `pulini`, `hammasini`, `to‘liq`, `yarmini`, `yarim` va ularning Kirill shakllari).

Bajarilmasa: low confidence, natija `UNKNOWN` yoki `ASK_*`.

### 9. Qoidalar to‘plami (deterministik qarorlar)

1. **Fe'l leksikoni:** `berdi / to‘ladi / qaytardi / to‘lov` → `CREATE_PAYMENT`. `yoz / yozing / nasiya / yana` → `CREATE_DEBT`. Fe'lsiz `{ism} {summa}` → `CREATE_DEBT` (TT §7).
2. **Bir nechta turli summa** (`Murod 50 ming berdi 100 ming`) → summa tanlanmaydi (`amount = null`, `NONE`), `ASK_AMOUNT`.
3. **Summa yo‘q:** `Murodga yoz` → `ASK_AMOUNT`. `Murod pul berdi` → `ASK_AMOUNT` (TT §16 medium).
4. **Faqat ism** (`Murod`) → `intent = UNKNOWN`, `customer = "murod"`: moliyaviy harakat bajarilmaydi (TT §16 low). Resolver ishlaydi: bitta mijoz → `SHOW_CUSTOMER_MENU` (qoldiq va [Nasiya][To‘lov][Tarix] tugmalari, hech narsa yozilmaydi); bir nechta → `ASK_CUSTOMER` (TT §13); topilmasa → `UNKNOWN`. `customer` faqat shu "faqat ism" holatida `UNKNOWN` bilan birga to‘ldiriladi, boshqa `UNKNOWN`larda `null`.
   4a. **Yo‘nalish:** `Murodga 50 ming berdim` (men berdim) → `CREATE_DEBT`. `Murod 50 ming berdi` (u berdi) → `CREATE_PAYMENT`. `Murodga 50 ming berdi` (yo‘nalish noaniq) → `UNKNOWN`, `ASK` ikki tugma bilan: [Nasiya yozish] [To‘lov yozish].
   4b. **Zamon va inkor:** kelasi zamon (`beradi`, `to‘laydi`, `bermoqchi`, `berishi kerak`), inkor (`bermadi`, `to‘lamadi`) va savol (`berdimi?`) moliyaviy operatsiya **emas** → `UNKNOWN`, draft yaratilmaydi.
5. **Manfiy yoki nol summa** → `REJECT_INVALID_AMOUNT`. `> 10 mlrd` → `REJECT_INVALID_AMOUNT`. `≥ 50 mln` → `WARN_LARGE_AMOUNT`.
6. **`FULL` (qarzini berdi, pulini berdi):** summa joriy qoldiq; **har doim** tasdiq (`CONFIRM_FULL`), summa ko‘rsatiladi (TT §9). Qoldiq 0 bo‘lsa `REJECT_NO_DEBT`.
7. **`FRACTION` (yarmini berdi):** `floor(balance × n / d)`, so‘mga **pastga** yaxlitlanadi (to‘lov hech qachon qoldiqdan oshmaydi). Natija `0` bo‘lsa `REJECT_INVALID_AMOUNT`. Har doim `CONFIRM_FRACTION`.
8. **Sana:** `bugun` = 0, `kecha` = −1, `ertaga` (kelajak) = rad etiladi (`UNKNOWN`). "kecha ... yozgan edim" → `date_offset_days = −1`. Sana ko‘rsatilmasa 0.
9. **`yana`** summaga ta'sir qilmaydi, faqat `CREATE_DEBT`ga ishora (fe'l sifatida).
10. **Prompt-injection:** matndagi "ignore instructions", `system:`, JSON parchalari kabi ko‘rsatmalar e'tiborga olinmaydi. LLM chiqishi enum bilan cheklangan, summa grounding'dan o‘tishi shart, shuning uchun ta'sir qila olmaydi. Ko‘rsatma xarakteridagi xabar odatda `UNKNOWN`.

### 10. CustomerResolver (DB, deterministik)

Qidiruv `customers.normalized_name` bo‘yicha, faqat `ACTIVE`, faqat joriy `business_id`:

| Holat                                                | Natija                                                                             |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Bitta **aniq** moslik (`normalized_name == mention`) | Mijoz aniqlandi (tasdiqda baribir ko‘rsatiladi)                                    |
| ≥2 aniq moslik                                       | `ASK_CUSTOMER` (label bilan ajratilgan tugmalar)                                   |
| Faqat prefix/fuzzy moslik (`murod` ↔ `murodbek`)     | `ASK_CUSTOMER` (nomzodlar + "+ Yangi mijoz")                                       |
| Prefix + aniq moslik birga                           | `ASK_CUSTOMER` (aniq moslik birinchi, lekin avto tanlanmaydi)                      |
| Hech kim                                             | `CREATE_DEBT`: `CONFIRM_NEW_CUSTOMER`; `CREATE_PAYMENT`: `REJECT_UNKNOWN_CUSTOMER` |

> **TT §12:** noto‘g‘ri mijoz tanlash false negative'dan xavfliroq. Shubha bo‘lsa — savol.

Avto tanlash faqat bitta holatda: aniq moslik **bitta** va boshqa hech qanday prefix/fuzzy nomzod yo‘q. Masalan bazada faqat `Murodbek` bo‘lsa va `Murod` yozilsa, savol beriladi. Bazada `Murod` va `Murodbek` ikkalasi bo‘lsa va `Murod` yozilsa ham savol beriladi (TT §12 misoli). Bu ataylab konservativ qaror: ortiqcha bitta tugma bosish noto‘g‘ri mijozga yozilgan qarzdan arzon.

### 11. Action'lar (DecisionPolicy chiqishi)

```text
ASK_AMOUNT | ASK_CUSTOMER
CONFIRM | CONFIRM_FULL | CONFIRM_FRACTION | CONFIRM_NEW_CUSTOMER
WARN_LARGE_AMOUNT   (CONFIRM + ogohlantirish)
REJECT_OVERPAY | REJECT_NO_DEBT | REJECT_UNKNOWN_CUSTOMER | REJECT_INVALID_AMOUNT
BLOCKED_SUBSCRIPTION
SHOW_BALANCE | SHOW_HISTORY | SHOW_CUSTOMER_MENU | CREATE_CUSTOMER_FLOW
CANCELLED   ("bekor" matni yoki tugma)
UNKNOWN
```

`DecisionPolicy` toza funksiya: `(intent, resolution, balance, subscription, businessConfig) → Action`. Hech qanday I/O yo‘q. Intent × resolution × balans × obuna bo‘yicha to‘liq jadval-testlar bilan qoplanadi.

**Hech qaysi action o‘zi ledger'ga yozmaydi.** `CONFIRM*` faqat draft yaratadi (ADR-0003).

### 12. Conversation (kontekst)

- State: `IDLE | AWAIT_AMOUNT | AWAIT_CUSTOMER | AWAIT_CONFIRM | AWAIT_EDIT`, TTL 15 daqiqa, DB'da.
- State kontekst bo‘lib xizmat qiladi, **moliyaviy haqiqat emas**. Har bir qadamda balans va mijoz ledger'dan qayta o‘qiladi (TT §13).
- Yangi to‘liq buyruq (intent + summa) kelsa, eski state/draft bekor qilinadi.
- "Birinchisi", "ikkinchisi" kabi javoblar faqat joriy nomzodlar ro‘yxatiga nisbatan.

### 13. Logging va maxfiylik

- `ai_interpretations`: `input_redacted` (PII chiqarilgan), rule va LLM chiqishlari, yakuniy intent, `provider`, `model`, `prompt_version`, `latency_ms`, natija (`CONFIRMED | EDITED | CANCELLED | REJECTED | EXPIRED`). **30 kun** saqlanadi, keyin o‘chiriladi yoki anonimlashtiriladi.
- Prod `pino` loglarida xabar matni yozilmaydi (uzunlik va hash).
- Foydalanuvchiga "AI", "model", "prompt" tushunchalari ko‘rsatilmaydi (TT §2).

### 14. Baholash (eval)

- `packages/nlp-eval/golden.jsonl` yagona haqiqat manbai (ushbu repo'da v0 mavjud).
- Metrikalar: intent, customer, amount, date accuracy; **wrong financial transaction rate**.
- **WFT ta'rifi:** draft yaratilib, uning `(type, customer, amount, date)` kutilgandan farq qilsa, yoki `no_draft` bo‘lishi kerak bo‘lgan holatda draft yaratilsa.
- **CI gate:** golden set'da WFT = 0. Prompt, model yoki parser o‘zgarsa eval majburiy ishlaydi (T6.7).

## Ko‘rib chiqilgan muqobillar

- **Faqat LLM:** o‘zbek Kirill/aralash va summalarda aniqlik past, tekshirib bo‘lmaydi.
- **Faqat rule parser:** erkin matnga yetarlicha tolerant emas (Q4: aniqlik ustuvor).
- **LLM'ga mijozlar ro‘yxatini berib tanlatish:** noto‘g‘ri mijoz tanlash xavfi va maxfiylik; resolver deterministik bo‘lishi kerak.
- **Function calling / tool use:** LLM'ga ledger'ga yo‘l ochadi, TT §14 ga zid.

## Oqibatlar

- Gemini ishlamasa mahsulot to‘xtamaydi (rule fallback, qat'iyroq tasdiq).
- Har bir AI chiqishi qo‘shimcha zod, grounding va resolver qatlamlaridan o‘tadi, shuning uchun LLM xatosi moliyaviy xatoga aylana olmaydi.
