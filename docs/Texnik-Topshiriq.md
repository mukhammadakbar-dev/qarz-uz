# Telegram Nasiya — Texnik topshiriq

**Versiya:** 1.0
**Status:** MVP Specification
**Platforma:** Telegram Bot + Telegram Mini App
**Asosiy til:** O‘zbek tili — Lotin / Kirill
**Keyingi til:** Rus tili

---

## 1. Loyiha maqsadi

Kichik biznes egalari va sotuvchilar uchun mijozlarning nasiya/qarzdorligini Telegram orqali juda tez va sodda qayd qilish, ko‘rish va boshqarish tizimini yaratish.

Asosiy muammo:

* qarzlarni daftarga yozish noqulay;
* sotuvchi yozishni unutishi mumkin;
* qarzdorliklar vaqt o‘tishi bilan aralashib ketadi;
* kim qancha qarzdorligini topish qiyin;
* oddiy hisob uchun alohida accounting dasturidan foydalanish ortiqcha murakkab.

Mahsulotning asosiy g‘oyasi:

> **Foydalanuvchi tizim tilini o‘rganmaydi. Tizim foydalanuvchining tilini tushunadi.**

Foydalanuvchi qarzni oddiy odamga gapirgandek yozadi:

```text
Murodbek 450 ming
```

yoki:

```text
Murod 50 ming berdi
```

yoki:

```text
Мурод 50 минг берди
```

Tizim ushbu xabarni tushunib, tegishli moliyaviy operatsiyani yaratadi.

---

# 2. Product Philosophy

Mahsulot **"AI product"** sifatida pozitsiyalanmaydi.

Foydalanuvchiga:

* AI;
* LLM;
* NLP;
* model;
* prompt;

kabi texnik tushunchalar ko‘rsatilmaydi.

AI faqat ichki interpretation layer sifatida ishlatiladi.

Asosiy product value:

> **Nasiya yozish daftarga yozishdan ham oson bo‘lishi kerak.**

Asosiy prinsiplar:

1. Soddalik
2. Tezlik
3. Ishonchlilik
4. Tabiiy input
5. Minimal interaction
6. Noaniq moliyaviy operatsiyani taxmin qilmaslik

---

# 3. Target Users

## 3.1. Business Owner

Kichik biznes egasi.

Masalan:

* oziq-ovqat do‘koni;
* mahalla do‘koni;
* kiyim do‘koni;
* qurilish mollari;
* xizmat ko‘rsatish biznesi;
* boshqa kichik bizneslar.

Huquqlari:

* biznes yaratish;
* xodim qo‘shish;
* xodimni o‘chirish/deaktivatsiya qilish;
* mijozlarni boshqarish;
* qarzlarni ko‘rish;
* to‘lovlarni ko‘rish;
* ledger tarixini ko‘rish;
* biznes sozlamalarini boshqarish.

## 3.2. Staff / Seller / Cashier

Biznes egasi tomonidan qo‘shilgan xodim.

Default huquqlar:

* mijoz yaratish;
* qarz qo‘shish;
* to‘lov kiritish;
* mijozlarni ko‘rish;
* o‘z kiritgan operatsiyalarini ko‘rish.

Staff biznes sozlamalarini boshqara olmaydi.

Permission modeli keyinchalik kengaytiriladigan bo‘lishi kerak.

---

# 4. Platforma

Mahsulot ikki asosiy interfeysdan iborat:

```text
Telegram Bot
    +
Telegram Mini App
```

## Telegram Bot

Asosiy interaction layer.

Qarz va to‘lovlarni tezkor kiritish uchun ishlatiladi.

## Telegram Mini App

Management interface.

Quyidagilar uchun ishlatiladi:

* qarzdorlar ro‘yxati;
* customer detail;
* ledger history;
* dashboard;
* staff management;
* qidiruv;
* qo‘shimcha boshqaruv.

> Foydalanuvchi qarz kiritish uchun Mini App ochishga majbur bo‘lmasligi kerak.

---

# 5. Core User Flow

Umumiy flow:

```text
User
  ↓
Telegram Bot
  ↓
Natural language input
  ↓
Interpretation
  ↓
Validation
  ↓
Confirmation / Clarification
  ↓
Business Rules
  ↓
Ledger Transaction
  ↓
Updated Balance
```

Misol:

```text
User:
Murodbek 450 ming
```

↓

```text
Murodbek
+450 000 so‘m

[Saqlash] [O‘zgartirish]
```

↓

```text
✓ Murodbekka 450 000 so‘m nasiya yozildi.
```

---

# 6. Natural Language Input

Foydalanuvchi oldindan belgilangan command yoki formatga majbur qilinmaydi.

Quyidagi inputlar qo‘llab-quvvatlanishi kerak:

```text
Murod 50 ming
Murod 50k
Murod 50 000
Murodga 50 ming yoz
Murod 50 ming berdi
Мурод 50 минг берди
Murod 50 минг berdi
муродга 50 000 yoz
```

Tizim real Telegram inputlaridagi imlo va format farqlariga imkon qadar tolerant bo‘lishi kerak.

---

# 7. Debt Creation

User:

```text
Murodbek 450 ming
```

System:

```text
Murodbek
+450 000 so‘m

[Saqlash]
[O‘zgartirish]
```

Tasdiqlangach:

```text
✓ Murodbekka 450 000 so‘m nasiya yozildi.
```

Backend'da:

```text
DEBT +450000 UZS
```

ledger entry yaratiladi.

---

# 8. Payment Creation

User:

```text
Murod 200 ming berdi
```

Agar Murodning qarzi 450 000 so‘m bo‘lsa:

```text
Murod

To‘lov: 200 000 so‘m
Qoldiq: 250 000 so‘m

[Saqlash]
[O‘zgartirish]
```

Tasdiqlangach:

```text
✓ Murod 200 000 so‘m to‘ladi.
Qoldiq: 250 000 so‘m.
```

Backend:

```text
PAYMENT -200000 UZS
```

---

# 9. Full Payment

User:

```text
Murod qarzini berdi
```

Agar Murodning qarzi 450 000 so‘m bo‘lsa:

```text
Murodning hozirgi qarzi 450 000 so‘m.

Qarzini to‘liq yopdimi?

[Ha, 450 000 so‘m]
[Boshqa summa]
[Bekor qilish]
```

Tizim summani o‘zboshimchalik bilan taxmin qilib transaction yaratmasligi kerak.

---

# 10. Partial Payment

User:

```text
Murod qarzining yarmini berdi
```

System:

Agar qarz 450 000 bo‘lsa:

```text
Murodning qarzi: 450 000 so‘m.

Yarimi: 225 000 so‘m.

225 000 so‘m to‘lov sifatida yozilsinmi?

[Ha]
[O‘zgartirish]
[Bekor qilish]
```

Yoki:

```text
Murod 100 ming berdi
```

↓

```text
To‘lov: 100 000 so‘m
Qoldiq: 350 000 so‘m

[Saqlash]
```

---

# 11. Missing Information

User:

```text
Murodga yoz
```

System:

```text
Murodga qancha nasiya yozay?
```

User:

```text
100 ming
```

System:

```text
Murod
+100 000 so‘m

[Saqlash]
```

---

# 12. Ambiguous Customer

Agar bir nechta customer bir xil yoki o‘xshash ismga ega bo‘lsa:

```text
Qaysi Murodni nazarda tutdingiz?

[Мурод ака]
[Муродбек]
[Мурод — qo‘shni]
[+ Yangi mijoz]
```

Tizim noto‘g‘ri customer tanlashdan ko‘ra clarification so‘rashi kerak.

> Moliyaviy operatsiyada false positive false negative'dan xavfliroq.

---

# 13. Context-aware Conversation

Bot oldingi conversation context'ni hisobga olishi kerak.

Misol:

```text
User:
Murod
```

Bot:

```text
Qaysi Murodni nazarda tutdingiz?
```

User:

```text
Birinchisi
```

Bot oldingi context asosida customer'ni aniqlaydi.

Lekin conversation context moliyaviy truth hisoblanmaydi.

**Source of truth — Ledger.**

---

# 14. AI / NLP Layer

AI faqat user input'ini structured intent'ga aylantirish uchun ishlatiladi.

AI database'ga to‘g‘ridan-to‘g‘ri yozmaydi.

### Noto‘g‘ri

```text
User
 ↓
LLM
 ↓
Database
```

### To‘g‘ri

```text
User
 ↓
AI/NLP Interpreter
 ↓
Structured Intent
 ↓
Validation
 ↓
Business Rules
 ↓
Ledger Transaction
 ↓
Database
```

AI savolga javob beradi:

> "User nimani nazarda tutdi?"

Backend savolga javob beradi:

> "Ushbu operatsiyani amalga oshirish mumkinmi va qanday amalga oshiriladi?"

---

# 15. Structured Intent

MVP intentlari:

```text
CREATE_DEBT
CREATE_PAYMENT
VIEW_CUSTOMER_BALANCE
VIEW_CUSTOMER_HISTORY
CREATE_CUSTOMER
UNKNOWN
```

Interpreter natijasi taxminan:

```json
{
  "intent": "CREATE_DEBT",
  "customer": "Murodbek",
  "amount": 450000,
  "currency": "UZS"
}
```

Qo‘shimcha metadata:

```text
customer_confidence
intent_confidence
amount_confidence
date_confidence
```

---

# 16. Confidence / Ambiguity

Interpretation natijasi ishonchlilik darajasiga ega bo‘lishi kerak.

### High confidence

```text
Murod 50 ming berdi
```

Tizim minimal confirmation bilan ishlashi mumkin.

### Medium confidence

```text
Murod pul berdi
```

Summasi noma'lum.

Tizim clarification so‘raydi.

### Low confidence

```text
Murod
```

Operation aniqlanmagan.

Tizim action bajarmaydi.

---

# 17. Financial Safety Rule

Quyidagi prinsip majburiy:

> **Noaniq moliyaviy operatsiya avtomatik bajarilmaydi.**

AI taxmin qilishi mumkin.

Backend taxmin qilmasligi kerak.

---

# 18. Language Support

## MVP

### O‘zbek — Lotin

```text
Murod 50 ming berdi
```

### O‘zbek — Kirill

```text
Мурод 50 минг берди
```

### Mixed script

```text
Murod 50 минг berdi
```

ham qo‘llab-quvvatlanadi.

## Keyingi bosqich

Rus tili.

---

# 19. UI Language vs Input Language

UI tili va user input tili bir-biridan mustaqil.

Masalan UI:

```text
O‘zbekcha — Lotin
```

bo‘lsa ham user:

```text
Мурод 50 минг берди
```

deb yozishi mumkin.

Input uchun tilni oldindan tanlash majburiy emas.

---

# 20. Text Normalization

Quyidagi variantlar bir xil qiymat sifatida interpretatsiya qilinishi kerak:

```text
50 ming
50ming
50 000
50000
50k
50 k
50 минг
50минг
```

Customer name normalization:

```text
Murod
murod
MUROD
Мурод
мурод
```

Fuzzy matching ishlatilganda noto‘g‘ri customer tanlash xavfi hisobga olinishi shart.

---

# 21. Customer

Model:

```text
Customer
--------
id
business_id
name
normalized_name
phone
notes
created_at
updated_at
```

Customer har doim ma'lum bir business'ga tegishli.

---

# 22. Ledger

Ledger — tizimning asosiy financial source of truth'i.

Har bir moliyaviy operatsiya alohida entry sifatida saqlanadi.

```text
LedgerEntry
-----------
id
business_id
customer_id
type
amount
currency
description
created_by
created_at
metadata
```

`type`:

```text
DEBT
PAYMENT
ADJUSTMENT
```

---

# 23. Balance

Masalan:

```text
+450000 DEBT
-200000 PAYMENT
-100000 PAYMENT
```

Natija:

```text
150000 UZS
```

Formula:

```text
balance = SUM(DEBT) - SUM(PAYMENT) + SUM(ADJUSTMENT)
```

Balance tarixdan deterministik hisoblanishi kerak.

---

# 24. Immutable Ledger

Eski transaction silently overwrite qilinmasligi kerak.

Misol:

Dastlab:

```text
DEBT +450000
```

Keyin xato aniqlansa:

```text
ADJUSTMENT -50000
```

kiritiladi.

Natija:

```text
400000
```

Shunda transaction history saqlanib qoladi.

---

# 25. Database Model

Minimal model:

```text
users
-----
id
telegram_user_id
username
first_name
last_name
created_at


businesses
----------
id
name
owner_user_id
currency
created_at
updated_at


business_members
----------------
id
business_id
user_id
role
status
created_at


customers
---------
id
business_id
name
normalized_name
phone
notes
created_at
updated_at


ledger_entries
--------------
id
business_id
customer_id
type
amount
currency
description
created_by
created_at
metadata
```

Keyinchalik:

```text
audit_logs
ai_interpretations
notifications
reminders
```

qo‘shilishi mumkin.

---

# 26. Multi-tenancy

Architecture boshidanoq multi-tenant bo‘lishi kerak.

Asosiy entitylar:

```text
Business
User
BusinessMember
Customer
LedgerEntry
```

Business-specific barcha ma'lumotlar `business_id` bilan scope qilinadi.

Business A ma'lumotlari Business B userlariga hech qanday holatda ko‘rinmasligi yoki o‘zgartirilmasligi kerak.

---

# 27. Transaction Consistency

Financial operation atomic bo‘lishi kerak.

Misol:

```text
BEGIN

validate customer
validate business membership
validate amount
create ledger entry

COMMIT
```

Xatolikda:

```text
ROLLBACK
```

Partial state qolmasligi kerak.

---

# 28. Idempotency

Telegram update yoki network retry sabab bitta transaction ikki marta yaratilmasligi kerak.

Incoming Telegram event uchun unique idempotency key ishlatiladi.

Masalan:

```text
telegram_update_id
```

yoki application-level request ID.

---

# 29. Overpayment

Agar customer qarzi:

```text
100 000
```

bo‘lsa va:

```text
150 000
```

to‘lov qilinsa, tizim silent ravishda noto‘g‘ri balance yaratmasligi kerak.

System:

```text
Murodning qarzi: 100 000 so‘m.

150 000 so‘m to‘lov kiritildi.

100 000 so‘m qarzni yopadi.
50 000 so‘m ortiqcha to‘lov bo‘lib qoladi.

Davom etilsinmi?
```

Overpayment uchun alohida business rule kerak.

---

# 30. Currency

MVP:

```text
UZS
```

bo‘ladi.

Database'da currency field saqlanadi:

```text
currency = UZS
```

Keyinchalik boshqa currency'lar qo‘shilishi mumkin.

---

# 31. Telegram Mini App

Mini App management interface sifatida ishlaydi.

## Dashboard

Ko‘rsatiladi:

```text
Jami qarzdorlik
1 250 000 so‘m

Qarzdorlar
12 ta

Bugungi operatsiyalar
8 ta
```

---

# 32. Customer List

```text
Qidirish...

Murodbek       450 000 so‘m
Ali             250 000 so‘m
Vali            120 000 so‘m
Sardor           80 000 so‘m
```

Sort:

* eng katta qarz;
* eng yangi;
* ism bo‘yicha.

---

# 33. Customer Detail

```text
Murodbek

Qoldiq
450 000 so‘m

----------------

Bugun
+450 000
Nasiya

----------------

[To‘lov qo‘shish]
[Nasiya qo‘shish]
```

History:

```text
07 Oct
+450 000
Nasiya

08 Oct
-200 000
To‘lov

Qoldiq: 250 000
```

---

# 34. Staff Management

Owner:

```text
Xodimlar

Ali — Sotuvchi
Vali — Kassir

[+ Xodim qo‘shish]
```

Staff Telegram account orqali business'ga ulanadi.

Har bir transaction `created_by` orqali qaysi user tomonidan yaratilgani aniqlanadi.

---

# 35. Bot Commands

Minimal commands:

```text
/start
/help
/menu
```

Asosiy workflow command orqali emas, natural input orqali ishlaydi.

Quick buttons bo‘lishi mumkin:

```text
➕ Nasiya qo‘shish
💵 To‘lov qo‘shish
👥 Qarzdorlar
```

Buttonlar natural inputni almashtirmaydi.

---

# 36. Security

Majburiy talablar:

* Telegram authentication;
* server-side authorization;
* RBAC;
* tenant isolation;
* input validation;
* rate limiting;
* webhook security;
* secure secrets management;
* audit logging;
* database backup;
* encrypted transport.

Client yuborgan quyidagi qiymatlarga ishonilmasligi kerak:

```text
business_id
user_id
customer_id
```

Barcha permission tekshiruvlari server-side bajariladi.

---

# 37. Privacy

Qarz ma'lumotlari moliyaviy ma'lumot hisoblanadi.

Shuning uchun:

* minimal data collection;
* access control;
* audit;
* encryption in transit;
* backup security;
* log sanitization;
* data retention policy;
* data deletion policy

ko‘zda tutiladi.

Sensitive user inputlar production loglariga keraksiz ravishda yozilmasligi kerak.

---

# 38. Recommended Architecture

MVP uchun **Modular Monolith** tavsiya etiladi.

```text
                    Telegram
                       │
             ┌─────────┴─────────┐
             │                   │
        Telegram Bot         Mini App
             │                   │
             └─────────┬─────────┘
                       ↓
                  API / Backend
                       │
          ┌────────────┼────────────┐
          │            │            │
       Identity      Ledger       AI/NLP
          │            │            │
          └────────────┼────────────┘
                       ↓
                   PostgreSQL
```

MVP bosqichida quyidagilar shart emas:

* Microservices;
* Kafka;
* Kubernetes;
* event-driven architecture.

Product-market fit'ga qadar architecture sodda bo‘lishi kerak.

---

# 39. AI Provider Abstraction

Application bitta AI provider'ga qattiq bog‘lanmasligi kerak.

Conceptual interface:

```text
AIProvider

interpret(message, context)
    -> StructuredIntent
```

Keyinchalik AI provider almashtirilishi mumkin.

AI model versiyasi interpretation loglarida qayd qilinishi mumkin.

---

# 40. Observability

Production'da:

* structured logs;
* request ID;
* Telegram update ID;
* business ID;
* user ID;
* ledger entry ID;
* error tracking;
* metrics;
* latency monitoring;
* AI interpretation metrics.

Sensitive data loglarda minimallashtiriladi.

---

# 41. Product Analytics

Asosiy metriclar:

## Activation

User onboarding'dan keyin birinchi transaction yaratishi.

## Time to First Transaction

## Transaction Completion Rate

```text
Input
→ Interpretation
→ Confirmation
→ Ledger
```

## Clarification Rate

AI qancha inputda qo‘shimcha savol bergani.

## Correction Rate

User interpretation'ni qancha marta o‘zgartirgani.

## Failed Interpretation Rate

## Daily Active Businesses

## Daily Transactions per Business

## Retention

7/30 kunlik retention.

Eng muhim qualitative metric:

> Foydalanuvchi daftar o‘rniga botdan foydalanishni davom ettiryaptimi?

---

# 42. AI Quality Metrics

AI sifati quyidagilar orqali o‘lchanadi:

```text
Intent accuracy
Customer resolution accuracy
Amount extraction accuracy
Date extraction accuracy
Wrong financial transaction rate
Clarification rate
Correction rate
```

Eng muhim metric:

> **Wrong financial transaction rate**

Moliyaviy transaction noto‘g‘ri yaratilmasligi kerak.

---

# 43. MVP Scope

## MUST HAVE

* Telegram Bot;
* Telegram Mini App;
* Business onboarding;
* Owner;
* Staff;
* Customer CRUD;
* Natural-language debt creation;
* Natural-language payment;
* Partial payment;
* Full payment;
* Customer balance;
* Ledger history;
* Customer search;
* Dashboard;
* Staff management;
* Uzbek Latin;
* Uzbek Cyrillic;
* Mixed-script input;
* Confirmation;
* Clarification;
* Authentication;
* Authorization;
* Auditability;
* Idempotency;
* Error handling.

## SHOULD HAVE

* Customer notes;
* Transaction description;
* Quick buttons;
* Operation cancellation;
* Correction/adjustment;
* Basic statistics;
* AI interpretation logs.

## LATER

* Russian;
* Payment reminders;
* Automatic Telegram notifications;
* SMS;
* Customer-facing interface;
* Online payments;
* Excel/CSV export;
* Accounting integrations;
* POS integration;
* Inventory;
* Multiple branches;
* Advanced analytics;
* Voice input.

---

# 44. Out of Scope — MVP

Quyidagilar MVP'ga kiritilmaydi:

* Full accounting system;
* Inventory management;
* Warehouse;
* POS;
* Tax accounting;
* Payroll;
* Online payment gateway;
* Advanced CRM;
* Complex reporting.

MVP'ning asosiy vazifasi:

> **Nasiya yozishni maksimal darajada oson qilish.**

---

# 45. Non-functional Requirements

## Performance

AI'siz backend operationlar:

```text
p95 < 500ms
```

maqsad qilinadi.

AI interpretation uchun alohida latency budget belgilanadi.

## Availability

MVP production uchun:

```text
99.5% monthly availability
```

maqsad.

## Scalability

Architecture quyidagi yo‘nalishda scale qilinadigan bo‘lishi kerak:

```text
Telegram
   ↓
Bot/API
   ↓
Application
   ↓
PostgreSQL
```

Dastlab horizontal scaling uchun modular architecture yetarli.

---

# 46. Critical Edge Cases

Test qilinishi shart:

```text
Murod 50 ming
Мурод 50 минг
Murod 50 минг
Мурод 50 ming
Murod 50k
Murod 50 000
Murodga 50 ming yoz
Murod 50 ming berdi
Murod pulini berdi
Murod qarzini to‘liq berdi
Murod qarzining yarmini berdi
Murodga kecha 100 ming yozgan edim
Murod 20 ming berdi
Murodga yana 30 ming
```

Shuningdek:

* bir xil ismli customerlar;
* noma'lum customer;
* summa yo‘qligi;
* customer yo‘qligi;
* zero amount;
* negative amount;
* juda katta amount;
* duplicate Telegram update;
* network retry;
* concurrent payment;
* bir vaqtning o‘zida ikki staff transaction yaratishi;
* staff access revoke;
* deleted/deactivated staff;
* business access revoke;
* overpayment.

---

# 47. Acceptance Criteria

## AC-01 — Debt Creation

Input:

```text
Murodbek 450 ming
```

Natija:

```text
DEBT +450000 UZS
```

ledgerda exactly one transaction yaratiladi.

---

## AC-02 — Payment

Given:

```text
Murod balance = 450000
```

Input:

```text
Murod 200 ming berdi
```

Natija:

```text
PAYMENT -200000
balance = 250000
```

---

## AC-03 — Full Payment

Given:

```text
Murod balance = 450000
```

Input:

```text
Murod qarzini berdi
```

System summani aniqlashtirmasdan transaction yaratmasligi kerak.

---

## AC-04 — Mixed Script

Quyidagi inputlar bir xil semantik operatsiyani ifodalashi kerak:

```text
Murod 50 ming berdi
Мурод 50 минг берди
Murod 50 минг berdi
```

---

## AC-05 — Duplicate Request

Bir xil Telegram update ikki marta yuborilsa:

```text
1 financial operation
```

dan ortiq transaction yaratilmasligi kerak.

---

## AC-06 — Tenant Isolation

Business A useri Business B ma'lumotlarini:

* ko‘ra olmaydi;
* o‘zgartira olmaydi;
* query qila olmaydi.

---

## AC-07 — Ambiguous Customer

Agar customer aniqlashda bir nechta ehtimol mavjud bo‘lsa:

System clarification so‘rashi kerak.

---

# 48. Development Phases

## Phase 1 — Foundation

* Repository;
* CI/CD;
* Environment setup;
* PostgreSQL;
* migrations;
* Telegram integration;
* authentication;
* business/member model;
* logging;
* error handling.

## Phase 2 — Ledger

* Customer;
* Ledger;
* Debt;
* Payment;
* Balance;
* Transaction;
* Idempotency;
* Audit.

## Phase 3 — Bot UX

* Natural input;
* Interpretation;
* Clarification;
* Confirmation;
* Cancellation;
* Customer resolution;
* Latin/Cyrillic normalization;
* Mixed-script handling.

## Phase 4 — Mini App

* Dashboard;
* Customer list;
* Customer detail;
* Ledger history;
* Payment;
* Debt;
* Staff management;
* Search.

## Phase 5 — Hardening

* Edge cases;
* Load testing;
* Security testing;
* AI evaluation dataset;
* Observability;
* Backup;
* Recovery testing.

## Phase 6 — Real-world Pilot

10–30 ta real kichik biznes bilan pilot.

Pilot davomida quyidagilar yig‘iladi:

* real user inputlar;
* clarification holatlari;
* correction holatlari;
* customer matching xatolari;
* amount parsing xatolari;
* UX friction;
* foydalanuvchi tashlab ketadigan flowlar.

Pilot ma'lumotlari asosida:

* interpretation;
* normalization;
* confirmation logic;
* UX

iteratsiya qilinadi.

---

# 49. Engineering Principles

### Principle 1

> AI database'ga to‘g‘ridan-to‘g‘ri yozmaydi.

### Principle 2

> Ledger — financial source of truth.

### Principle 3

> Noaniq financial operation avtomatik bajarilmaydi.

### Principle 4

> User formatni o‘rganmaydi; system userni tushunadi.

### Principle 5

> UI language va input language mustaqil.

### Principle 6

> Latin, Cyrillic va mixed-script real inputlar first-class citizen.

### Principle 7

> Product "AI" sifatida emas, oddiy nasiya yordamchisi sifatida ko‘rsatiladi.

### Principle 8

> MVP uchun modular monolith afzal.

### Principle 9

> Financial transactionlar idempotent va auditable bo‘lishi kerak.

### Principle 10

> Soddalik — asosiy feature.

---

# 50. Yakuniy Product Definition

Mahsulot:

> **Kichik bizneslar uchun Telegram ichidagi sodda nasiya hisobi.**

Foydalanuvchi:

```text
Murodbek 450 ming
```

deb yozadi.

Keyin:

```text
Murod 200 ming berdi
```

deb yozadi.

Tizim:

* customer'ni aniqlaydi;
* operation'ni tushunadi;
* noaniqlik bo‘lsa savol beradi;
* kerak bo‘lsa confirmation oladi;
* deterministic business logic orqali transaction yaratadi;
* ledger'ni yangilaydi;
* qoldiqni ko‘rsatadi.

Mini App orqali foydalanuvchi:

* barcha qarzdorlarni;
* jami qarzni;
* customer history'ni;
* to‘lovlarni;
* nasiya operatsiyalarini;
* staff'ni

boshqaradi.

Asosiy maqsad:

> **Daftarni almashtirish emas. Daftardan foydalanishdan ham osonroq tajriba yaratish.**

Asosiy texnik prinsip:

> **LLM noto‘g‘ri tushunishi mumkin. Ledger noto‘g‘ri bo‘lishi mumkin emas.**
