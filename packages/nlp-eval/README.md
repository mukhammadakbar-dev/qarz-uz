# nlp-eval — golden dataset va baholash

Interpretatsiya (ADR-0004) sifatini o‘lchash uchun yagona haqiqat manbai.

```bash
node packages/nlp-eval/build-golden.mjs      # golden.jsonl ni qayta yig‘adi (deterministik)
node packages/nlp-eval/validate-golden.mjs   # sxema, izchillik va qamrov tekshiruvi
```

`golden.jsonl` ni qo‘lda tahrirlamang: `handwritten.mjs` (qo‘lda holatlar) yoki `build-golden.mjs` (generator) ni o‘zgartirib qayta yig‘ing.

## Tarkib (v0)

| Qism                  | Soni | Izoh                                                              |
| --------------------- | ---- | ----------------------------------------------------------------- |
| Qo‘lda (`HW-*`)       | ~230 | TT §46, §6, §20, AC-01…07, xavfsizlik, kontekstli va ko‘p qadamli |
| Generatsiya (`GEN-*`) | 170  | 22 ism × 28 summa shakli × 5 skript rejimi × shablonlar           |

Skript rejimlari (`mode-XYZ`: ism, summa, fe'l; `L` = Lotin, `C` = Kirill):
`LLL`, `CCC`, `LCL` (`Murod 50 минг berdi`), `CLL` (`Мурод 50 ming berdi`), `LLC`.

## Holat formati

Har bir qator — bitta holat. Uch ko‘rinish:

**1. Kontekstsiz (interpreter darajasi):**

```json
{
  "id": "HW-0008",
  "tags": ["tt46"],
  "input": "Murod 50 ming berdi",
  "expect": {
    "intent": "CREATE_PAYMENT",
    "customer": "murod",
    "amount": 50000,
    "amount_kind": "ABSOLUTE",
    "fraction": null,
    "date_offset_days": 0
  }
}
```

**2. Kontekst bilan (resolver + decision policy):** `context.customers` (`name`, `balance`, ixtiyoriy `label`, `archived`), ixtiyoriy `context.subscription` (`EXPIRED`) va `expect.action`.

```json
{
  "id": "HW-0190",
  "input": "Murod 150 ming berdi",
  "context": { "customers": [{ "name": "Murod", "balance": 100000 }] },
  "no_draft": true,
  "expect": {
    "intent": "CREATE_PAYMENT",
    "customer": "murod",
    "amount": 150000,
    "amount_kind": "ABSOLUTE",
    "action": "REJECT_OVERPAY",
    "max_payable": 100000
  }
}
```

**3. Ko‘p qadamli (`turns`):** har bir qadam `input` (matn) yoki `button` (`other_amount`, `pay_max`, `save`, `cancel`) va `expect.action`.

### `expect` maydonlari

| Maydon                                                                                         | Ma'nosi                                                                                                                                             |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `intent`                                                                                       | `CREATE_DEBT`, `CREATE_PAYMENT`, `VIEW_CUSTOMER_BALANCE`, `VIEW_CUSTOMER_HISTORY`, `CREATE_CUSTOMER`, `UNKNOWN`                                     |
| `customer`                                                                                     | normalize qilingan ism (Lotin, lowercase, ASCII `'`, qo‘shimchasiz) yoki `null`. `UNKNOWN` da faqat "faqat ism" (`bare-name`) holatida to‘ldiriladi |
| `amount`                                                                                       | butun so‘m yoki `null`. `FULL`/`FRACTION`/`NONE` da doim `null`                                                                                     |
| `amount_kind`                                                                                  | `ABSOLUTE`, `FULL`, `FRACTION`, `NONE`                                                                                                              |
| `fraction`                                                                                     | `[n, d]`, faqat `FRACTION` da                                                                                                                       |
| `date_offset_days`                                                                             | `0` = bugun, `-1` = kecha. Hech qachon kelajak emas                                                                                                 |
| `phone`                                                                                        | faqat `CREATE_CUSTOMER`, `+998XXXXXXXXX`                                                                                                            |
| `action`                                                                                       | DecisionPolicy natijasi (ADR-0004 §11). Faqat kontekstli holatlarda                                                                                 |
| `pay_amount`, `balance_after`, `max_payable`, `candidate_count`, `ask_label`, `resolved_label` | action bilan bog‘liq qo‘shimcha kutilgan qiymatlar                                                                                                  |
| `no_draft` (case darajasida)                                                                   | Hech qanday draft (`CONFIRM*`, `WARN_LARGE_AMOUNT`) yaratilmasligi **shart**                                                                        |
| `group` (case darajasida)                                                                      | Bir guruhdagi barcha holatlar **aynan bir xil** `expect` bergan bo‘lishi shart (AC-04, TT §20)                                                      |

## Metrikalar (T3.1 eval harness shularni hisoblaydi)

- **Intent / customer / amount / date accuracy:** kontekstsiz holatlarda `expect` bilan solishtiriladi. `customer` faqat `expect.customer != null` bo‘lganda baholanadi.
- **Action accuracy:** kontekstli va ko‘p qadamli holatlarda.
- **Wrong financial transaction (WFT) rate** — eng muhimi. Quyidagilardan birortasi WFT hisoblanadi:
  1. draft yaratildi va `(type, customer, amount, date)` kutilgandan farq qiladi;
  2. `no_draft: true` holatda draft yaratildi;
  3. `REJECT_*` kutilgan holatda draft yaratildi.
- **CI gate:** WFT = 0 (T6.7). Boshqa metrikalar uchun chegaralar pilotdan keyin belgilanadi.

## Validator nimani tekshiradi

- Sxema, ID noyobligi, normalize qilingan ism, `amount`/`amount_kind`/`fraction` izchilligi.
- **Reference model:** kontekstli holatlarda ADR-0004 dagi resolver va policy qoidalarining kichik nusxasi bilan `action`, `balance_after`, `pay_amount`, `max_payable`, `candidate_count` arifmetik jihatdan tekshiriladi. Ya'ni dataset o‘zi bilan zid kelmaydi.
- Guruhlar (AC-04, TT20) bir xil semantikada.
- Qamrov: TT §46 ning 14 holati, 6 intentning hammasi, 18 action'ning hammasi, Kirill ≥30, aralash ≥30, Lotin ≥100, `no_draft` ≥40, jami ≥200, ko‘p qadamli ≥8.

## Ma'lum cheklovlar (v0)

- **Haqiqiy foydalanuvchi inputlari yo‘q.** Dataset sintetik va qo‘lda yozilgan. Pilotdan keyin anonimlashtirilgan real inputlar bilan boyitiladi (T7.3), 500+ gacha o‘sadi (T6.7).
- **Rus tili** MVP'da yo‘q, golden'da ham yo‘q.
- Kirill nomlarning ayrim imlo variantlari (`Жасур`/`Джасур`, `Шаҳзод`/`Шахзод`) hali yo‘q: ular normalize qilingach turlicha bo‘ladi va bu resolver darajasida qaror talab qiladi.
- "oldi" (`Murod 100 ming oldi`) `CREATE_DEBT` deb belgilangan (`note` maydoni bor). Pilotda tekshiriladi.
