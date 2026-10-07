#!/usr/bin/env node
// golden.jsonl ni tekshiradi: sxema, ichki izchillik, qamrov (coverage).
// Ishga tushirish: node packages/nlp-eval/validate-golden.mjs
// Muvaffaqiyatsiz bo‘lsa exit code 1.
//
// Eslatma: bu fayl dataset xatolarini ushlaydi. U interpreter yoki policy emas, lekin
// ADR-0004 dagi resolver/policy qoidalarining kichik "reference" modelini o‘z ichiga oladi,
// shuning uchun qo‘lda yozilgan summalar va action'lar arifmetik jihatdan tekshiriladi.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] ?? join(here, 'golden.jsonl');

const INTENTS = [
  'CREATE_DEBT',
  'CREATE_PAYMENT',
  'VIEW_CUSTOMER_BALANCE',
  'VIEW_CUSTOMER_HISTORY',
  'CREATE_CUSTOMER',
  'UNKNOWN',
];
const KINDS = ['ABSOLUTE', 'FULL', 'FRACTION', 'NONE'];
const ACTIONS = [
  'ASK_AMOUNT',
  'ASK_CUSTOMER',
  'CONFIRM',
  'CONFIRM_FULL',
  'CONFIRM_FRACTION',
  'CONFIRM_NEW_CUSTOMER',
  'WARN_LARGE_AMOUNT',
  'REJECT_OVERPAY',
  'REJECT_NO_DEBT',
  'REJECT_UNKNOWN_CUSTOMER',
  'REJECT_INVALID_AMOUNT',
  'BLOCKED_SUBSCRIPTION',
  'SHOW_BALANCE',
  'SHOW_HISTORY',
  'SHOW_CUSTOMER_MENU',
  'CREATE_CUSTOMER_FLOW',
  'CANCELLED',
  'UNKNOWN',
];
const DRAFT_ACTIONS = new Set([
  'CONFIRM',
  'CONFIRM_FULL',
  'CONFIRM_FRACTION',
  'CONFIRM_NEW_CUSTOMER',
  'WARN_LARGE_AMOUNT',
]);
const BUTTONS = ['other_amount', 'pay_max', 'save', 'cancel'];
const MAX_AMOUNT = 10_000_000_000;
const WARN_AMOUNT = 50_000_000;

const TT46 = [
  'Murod 50 ming',
  'Мурод 50 минг',
  'Murod 50 минг',
  'Мурод 50 ming',
  'Murod 50k',
  'Murod 50 000',
  'Murodga 50 ming yoz',
  'Murod 50 ming berdi',
  'Murod pulini berdi',
  'Murod qarzini to‘liq berdi',
  'Murod qarzining yarmini berdi',
  'Murodga kecha 100 ming yozgan edim',
  'Murod 20 ming berdi',
  'Murodga yana 30 ming',
];

// ── Minimal normalize (ADR-0004 §2): context mijoz nomlarini solishtirish uchun ──
const TRANSLIT = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'j',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'x',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  ъ: "'",
  ы: 'i',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  ў: "o'",
  қ: 'q',
  ғ: "g'",
  ҳ: 'h',
};
const normalize = (s) =>
  s
    .normalize('NFC')
    .replace(/[ʻʼ‘’`´]/g, "'")
    .toLowerCase()
    .replace(/[а-яёўқғҳ]/g, (ch) => TRANSLIT[ch] ?? ch)
    .replace(/\s+/g, ' ')
    .trim();

const hasCyr = (s) => /[а-яёўқғҳА-ЯЁЎҚҒҲ]/.test(s);
const hasLat = (s) => /[a-zA-Z]/.test(s);
const scriptOf = (s) =>
  hasCyr(s) && hasLat(s) ? 'mixed' : hasCyr(s) ? 'cyrillic' : hasLat(s) ? 'latin' : 'none';

const errors = [];
const err = (id, msg) => errors.push(`${id}: ${msg}`);
const isInt = (v) => Number.isInteger(v);

// ── Reference resolver (ADR-0004 §10) ──
function resolve(context, mention) {
  const m = normalize(mention);
  const active = context.customers.filter((c) => !c.archived);
  const exact = active.filter((c) => normalize(c.name) === m);
  const prefix = active.filter((c) => {
    const n = normalize(c.name);
    return n !== m && (n.startsWith(m) || m.startsWith(n));
  });
  if (exact.length === 1 && prefix.length === 0)
    return { kind: 'resolved', customer: exact[0], exactAll: exact };
  if (exact.length + prefix.length === 0) return { kind: 'none', exactAll: exact };
  return { kind: 'ambiguous', count: exact.length + prefix.length, exactAll: exact };
}

// ── Reference policy (ADR-0004 §9, §11): faqat arifmetik/izchillik tekshiruvi uchun ──
function referenceDecision(c) {
  const e = c.expect;
  const ctx = c.context;
  const expired = ctx.subscription === 'EXPIRED';
  const writes =
    e.intent === 'CREATE_DEBT' || e.intent === 'CREATE_PAYMENT' || e.intent === 'CREATE_CUSTOMER';

  if (e.intent === 'CREATE_CUSTOMER') {
    if (expired) return { action: 'BLOCKED_SUBSCRIPTION' };
    const exists = ctx.customers.some((x) => !x.archived && normalize(x.name) === e.customer);
    return exists
      ? { action: 'CREATE_CUSTOMER_FLOW', ask_label: true }
      : { action: 'CREATE_CUSTOMER_FLOW' };
  }
  if (e.intent === 'UNKNOWN') {
    if (!e.customer) return { action: 'UNKNOWN' };
    const r = resolve(ctx, e.customer);
    if (r.kind === 'resolved') return { action: 'SHOW_CUSTOMER_MENU' };
    if (r.kind === 'ambiguous') return { action: 'ASK_CUSTOMER', candidate_count: r.count };
    return { action: 'UNKNOWN' };
  }
  if (writes && expired) return { action: 'BLOCKED_SUBSCRIPTION' };
  if (!e.customer) return { action: 'ASK_CUSTOMER' };

  const r = resolve(ctx, e.customer);
  if (r.kind === 'ambiguous') return { action: 'ASK_CUSTOMER', candidate_count: r.count };
  const isView = e.intent === 'VIEW_CUSTOMER_BALANCE' || e.intent === 'VIEW_CUSTOMER_HISTORY';
  if (r.kind === 'none') {
    if (isView || e.intent === 'CREATE_PAYMENT') return { action: 'REJECT_UNKNOWN_CUSTOMER' };
    // CREATE_DEBT: yangi mijoz
    if (e.amount_kind === 'NONE') return { action: 'ASK_AMOUNT' };
    if (!isInt(e.amount) || e.amount <= 0 || e.amount > MAX_AMOUNT)
      return { action: 'REJECT_INVALID_AMOUNT' };
    return { action: 'CONFIRM_NEW_CUSTOMER' };
  }
  const b = r.customer.balance;
  if (e.intent === 'VIEW_CUSTOMER_BALANCE') return { action: 'SHOW_BALANCE', balance: b };
  if (e.intent === 'VIEW_CUSTOMER_HISTORY') return { action: 'SHOW_HISTORY' };

  if (e.intent === 'CREATE_DEBT') {
    if (e.amount_kind === 'NONE') return { action: 'ASK_AMOUNT' };
    if (e.amount <= 0 || e.amount > MAX_AMOUNT) return { action: 'REJECT_INVALID_AMOUNT' };
    return {
      action: e.amount >= WARN_AMOUNT ? 'WARN_LARGE_AMOUNT' : 'CONFIRM',
      balance_after: b + e.amount,
    };
  }
  // CREATE_PAYMENT
  if (e.amount_kind === 'NONE') return { action: 'ASK_AMOUNT' };
  if (e.amount_kind === 'ABSOLUTE' && (e.amount <= 0 || e.amount > MAX_AMOUNT))
    return { action: 'REJECT_INVALID_AMOUNT' };
  if (b === 0) return { action: 'REJECT_NO_DEBT' };
  if (e.amount_kind === 'FULL') return { action: 'CONFIRM_FULL', pay_amount: b, balance_after: 0 };
  if (e.amount_kind === 'FRACTION') {
    const pay = Math.floor((b * e.fraction[0]) / e.fraction[1]);
    if (pay <= 0) return { action: 'REJECT_INVALID_AMOUNT' };
    return { action: 'CONFIRM_FRACTION', pay_amount: pay, balance_after: b - pay };
  }
  if (e.amount > b) return { action: 'REJECT_OVERPAY', max_payable: b };
  return {
    action: e.amount >= WARN_AMOUNT ? 'WARN_LARGE_AMOUNT' : 'CONFIRM',
    balance_after: b - e.amount,
  };
}

function checkExpect(id, e, { turn = false } = {}) {
  if (turn) {
    if (!ACTIONS.includes(e.action)) err(id, `turn action noto‘g‘ri: ${e.action}`);
    for (const k of ['amount', 'balance_after', 'pay_amount', 'max_payable'])
      if (e[k] != null && !isInt(e[k])) err(id, `${k} butun son bo‘lishi kerak`);
    if (e.intent && !INTENTS.includes(e.intent)) err(id, `intent noto‘g‘ri: ${e.intent}`);
    return;
  }
  if (!INTENTS.includes(e.intent)) err(id, `intent noto‘g‘ri: ${e.intent}`);
  if (!KINDS.includes(e.amount_kind)) err(id, `amount_kind noto‘g‘ri: ${e.amount_kind}`);
  if (e.customer !== null && !(typeof e.customer === 'string' && /^[a-z0-9' ]+$/.test(e.customer)))
    err(id, `customer normalize qilinmagan: ${JSON.stringify(e.customer)}`);
  if (e.amount !== null && !isInt(e.amount)) err(id, 'amount butun son yoki null bo‘lishi kerak');
  if (e.amount_kind === 'ABSOLUTE' && e.amount === null)
    err(id, 'ABSOLUTE da amount null bo‘lmasligi kerak');
  if (e.amount_kind !== 'ABSOLUTE' && e.amount !== null)
    err(id, `${e.amount_kind} da amount null bo‘lishi kerak`);
  if (e.amount_kind === 'FRACTION') {
    const f = e.fraction;
    if (!(
      Array.isArray(f) &&
      f.length === 2 &&
      isInt(f[0]) &&
      isInt(f[1]) &&
      f[0] > 0 &&
      f[0] < f[1]
    ))
      err(id, 'fraction [n,d] bo‘lishi kerak, 0<n<d');
  } else if (e.fraction !== null) err(id, 'fraction faqat FRACTION da');
  if (!(isInt(e.date_offset_days) && e.date_offset_days <= 0 && e.date_offset_days >= -365))
    err(id, 'date_offset_days ∈ [-365, 0]');
  if (e.phone !== undefined && !/^\+998\d{9}$/.test(e.phone))
    err(id, 'phone +998XXXXXXXXX formatida bo‘lishi kerak');
  if (e.intent === 'FULL' || (e.amount_kind === 'FULL' && e.intent !== 'CREATE_PAYMENT'))
    err(id, 'FULL faqat CREATE_PAYMENT da');
  if (e.amount_kind === 'FRACTION' && e.intent !== 'CREATE_PAYMENT')
    err(id, 'FRACTION faqat CREATE_PAYMENT da');
  if (e.intent === 'UNKNOWN' && (e.amount !== null || e.amount_kind !== 'NONE'))
    err(id, 'UNKNOWN da amount bo‘lmasligi kerak');
}

// ── O‘qish ──
const raw = readFileSync(file, 'utf8').split('\n').filter(Boolean);
const cases = [];
for (const [i, line] of raw.entries()) {
  try {
    cases.push(JSON.parse(line));
  } catch {
    err(`line ${i + 1}`, 'JSON parse xato');
  }
}

const ids = new Set();
for (const c of cases) {
  const id = c.id ?? '(id yo‘q)';
  if (ids.has(id)) err(id, 'ID takrorlangan');
  ids.add(id);
  if (!Array.isArray(c.tags)) err(id, 'tags massiv bo‘lishi kerak');

  const single = typeof c.input === 'string';
  const multi = Array.isArray(c.turns);
  if (single === multi) {
    err(id, 'input yoki turns (bittasi) bo‘lishi kerak');
    continue;
  }

  if (c.context) {
    if (!Array.isArray(c.context.customers)) err(id, 'context.customers massiv bo‘lishi kerak');
    for (const cu of c.context.customers ?? []) {
      if (typeof cu.name !== 'string' || !isInt(cu.balance) || cu.balance < 0)
        err(id, `context mijoz noto‘g‘ri: ${JSON.stringify(cu)}`);
    }
    if (c.context.subscription && !['TRIAL', 'ACTIVE', 'EXPIRED'].includes(c.context.subscription))
      err(id, 'context.subscription noto‘g‘ri');
  }

  if (single) {
    if (c.input.length < 1 || c.input.length > 5000) err(id, 'input uzunligi 1..5000');
    if (!c.expect) {
      err(id, 'expect yo‘q');
      continue;
    }
    checkExpect(id, c.expect);
    const a = c.expect.action;
    if (c.context && !a) err(id, 'context bor, lekin expect.action yo‘q');
    if (!c.context && a) err(id, 'context yo‘q, lekin expect.action bor');
    if (a && !ACTIONS.includes(a)) err(id, `action noto‘g‘ri: ${a}`);
    if (c.expect.intent === 'UNKNOWN' && c.expect.customer && !c.tags.includes('bare-name'))
      err(id, 'UNKNOWN da customer faqat bare-name uchun');
    if (c.no_draft) {
      if (a && DRAFT_ACTIONS.has(a)) err(id, `no_draft, lekin action draft yaratadi: ${a}`);
      if (
        !a &&
        !(
          c.expect.intent === 'UNKNOWN' ||
          (c.expect.amount === null && c.expect.amount_kind === 'NONE')
        )
      )
        err(id, 'no_draft (kontekstsiz) holatda intent UNKNOWN yoki summa null bo‘lishi kerak');
    }
    if (c.context && c.expect.intent) {
      const ref = referenceDecision(c);
      for (const [k, v] of Object.entries(ref)) {
        if (c.expect[k] !== v)
          err(
            id,
            `reference model: ${k} kutilgan ${JSON.stringify(v)}, golden'da ${JSON.stringify(c.expect[k])}`,
          );
      }
      // Draft yaratuvchi action'larda hisoblangan maydonlar ko‘rsatilgan bo‘lsin
      if (
        DRAFT_ACTIONS.has(a) &&
        a !== 'CONFIRM_NEW_CUSTOMER' &&
        c.expect.balance_after === undefined
      )
        err(id, 'balance_after ko‘rsatilmagan');
    }
  } else {
    if (!c.context) err(id, 'turns uchun context majburiy');
    if (c.turns.length < 2) err(id, 'turns kamida 2 qadam');
    for (const [i, t] of c.turns.entries()) {
      if ((typeof t.input === 'string') === (typeof t.button === 'string'))
        err(id, `turn ${i}: input yoki button (bittasi)`);
      if (t.button && !BUTTONS.includes(t.button))
        err(id, `turn ${i}: noma'lum button ${t.button}`);
      if (!t.expect) {
        err(id, `turn ${i}: expect yo‘q`);
        continue;
      }
      checkExpect(`${id}#${i}`, t.expect, { turn: true });
      if (c.no_draft && DRAFT_ACTIONS.has(t.expect.action))
        err(id, `turn ${i}: no_draft, lekin draft yaratiladi`);
    }
  }
}

// ── Guruhlar: bir xil semantika ──
const groups = new Map();
for (const c of cases) if (c.group) groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
for (const [g, members] of groups) {
  const first = JSON.stringify(members[0].expect);
  for (const m of members)
    if (JSON.stringify(m.expect) !== first)
      err(m.id, `guruh ${g}: expect boshqalardan farq qiladi`);
  const inputs = new Set(members.map((m) => m.input));
  if (inputs.size !== members.length) err(g, 'guruhda takroriy input');
}
const need = { 'AC-04': 3, 'TT20-AMOUNT': 8, 'TT20-NAME': 5 };
for (const [g, n] of Object.entries(need))
  if ((groups.get(g)?.length ?? 0) < n) err(g, `guruhda kamida ${n} ta bo‘lishi kerak`);

// ── Qamrov ──
const singles = cases.filter((c) => typeof c.input === 'string');
const inputSet = new Set(singles.map((c) => c.input));
for (const t of TT46) if (!inputSet.has(t)) err('coverage', `TT §46 holati yo‘q: ${t}`);

const intentsSeen = new Set(singles.map((c) => c.expect?.intent));
for (const i of INTENTS) if (!intentsSeen.has(i)) err('coverage', `intent qamralmagan: ${i}`);

const actionsSeen = new Set();
for (const c of cases) {
  if (c.expect?.action) actionsSeen.add(c.expect.action);
  for (const t of c.turns ?? []) actionsSeen.add(t.expect?.action);
}
for (const a of ACTIONS) if (!actionsSeen.has(a)) err('coverage', `action qamralmagan: ${a}`);

const byScript = { latin: 0, cyrillic: 0, mixed: 0, none: 0 };
for (const c of singles) byScript[scriptOf(c.input)]++;
if (byScript.cyrillic < 30) err('coverage', `Kirill inputlar kam: ${byScript.cyrillic} < 30`);
if (byScript.mixed < 30) err('coverage', `Aralash skript inputlar kam: ${byScript.mixed} < 30`);
if (byScript.latin < 100) err('coverage', `Lotin inputlar kam: ${byScript.latin} < 100`);

const safety = cases.filter((c) => c.no_draft);
if (safety.length < 40)
  err('coverage', `no_draft (xavfsizlik) holatlar kam: ${safety.length} < 40`);
if (cases.length < 200) err('coverage', `jami holatlar kam: ${cases.length} < 200`);
const turnsCount = cases.filter((c) => c.turns).length;
if (turnsCount < 8) err('coverage', `ko‘p qadamli holatlar kam: ${turnsCount} < 8`);

// ── Hisobot ──
const countTag = (t) => cases.filter((c) => c.tags?.includes(t)).length;
console.log(`Fayl: ${file}`);
console.log(
  `Jami: ${cases.length} (kontekstsiz: ${singles.filter((c) => !c.context).length}, kontekstli: ${singles.filter((c) => c.context).length}, ko‘p qadamli: ${turnsCount})`,
);
console.log(
  `Skript: latin=${byScript.latin} cyrillic=${byScript.cyrillic} mixed=${byScript.mixed} none=${byScript.none}`,
);
console.log(
  `Intentlar: ${INTENTS.map((i) => `${i}=${singles.filter((c) => c.expect?.intent === i).length}`).join(' ')}`,
);
console.log(
  `Xavfsizlik (no_draft): ${safety.length}; injection=${countTag('injection')} negation=${countTag('negation')} future=${countTag('future')} overpay=${countTag('overpay')} ambiguous=${countTag('ambiguous')}`,
);
console.log(`Action qamrovi: ${actionsSeen.size}/${ACTIONS.length}`);

if (errors.length) {
  console.error(`\n✗ ${errors.length} ta xato:`);
  for (const e of errors.slice(0, 60)) console.error('  - ' + e);
  if (errors.length > 60) console.error(`  ... va yana ${errors.length - 60} ta`);
  process.exit(1);
}
console.log('\n✓ Golden dataset to‘g‘ri');
