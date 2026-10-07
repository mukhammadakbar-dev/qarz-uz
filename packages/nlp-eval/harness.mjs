// Golden dataset ustida interpreterni baholaydi (ADR-0004 §14).
// Metrikalar: intent / customer / amount / date aniqligi va WRONG FINANCIAL TRANSACTION (WFT) soni.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export function loadGolden(file = join(here, 'golden.jsonl')) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const isCreate = (intent) => intent === 'CREATE_DEBT' || intent === 'CREATE_PAYMENT';

/**
 * Bitta kontekstsiz holatni solishtiradi. `got` — StructuredIntent (camelCase).
 * Qaytaradi: { fields: {intent, customer, amount, kind, fraction, date, phone}, wrong }
 *  - customer faqat expect.customer != null bo'lganda baholanadi (UNKNOWN holatlarda ahamiyatsiz)
 *  - amount/kind/fraction/date faqat CREATE_* kutilganda baholanadi
 *  - wrong (WFT): natija CREATE_* bo'lib, kutilgandan farq qilsa; yoki kutilgan UNKNOWN/no_draft bo'lib, natija
 *    summasi aniq CREATE_* (draft yaratilishi mumkin) bo'lsa
 */
export function compareSingle(testCase, got) {
  const exp = testCase.expect;
  const fields = {};
  fields.intent = got.intent === exp.intent;
  fields.customer = exp.customer == null ? null : got.customer === exp.customer;

  const expectsCreate = isCreate(exp.intent);
  fields.amount = expectsCreate ? (got.amount ?? null) === (exp.amount ?? null) : null;
  fields.kind = expectsCreate ? got.amountKind === exp.amount_kind : null;
  fields.fraction = expectsCreate
    ? JSON.stringify(got.fraction ?? null) === JSON.stringify(exp.fraction ?? null)
    : null;
  fields.date = expectsCreate ? got.dateOffsetDays === exp.date_offset_days : null;
  fields.phone =
    exp.intent === 'CREATE_CUSTOMER' ? (got.phone ?? null) === (exp.phone ?? null) : null;

  let wrong = false;
  if (isCreate(got.intent)) {
    if (!expectsCreate || testCase.no_draft) {
      // Kutilgani: draft yo'q. Natija summali CREATE_* bo'lsa, tasdiq oynasigacha boradi.
      wrong = got.amount != null || got.amountKind === 'FULL' || got.amountKind === 'FRACTION';
    } else {
      wrong = ['intent', 'customer', 'amount', 'kind', 'fraction', 'date'].some(
        (k) => fields[k] === false,
      );
    }
  }
  return { fields, wrong };
}

export function evaluateInterpreter(parse, golden = loadGolden()) {
  const singles = golden.filter((c) => typeof c.input === 'string' && !c.context);
  const totals = {
    intent: [0, 0],
    customer: [0, 0],
    amount: [0, 0],
    kind: [0, 0],
    fraction: [0, 0],
    date: [0, 0],
    phone: [0, 0],
  };
  const failures = [];
  let wft = 0;

  for (const c of singles) {
    const got = parse(c.input);
    const { fields, wrong } = compareSingle(c, got);
    let failed = false;
    for (const [k, v] of Object.entries(fields)) {
      if (v === null) continue;
      totals[k][1]++;
      if (v) totals[k][0]++;
      else failed = true;
    }
    if (wrong) wft++;
    if (failed || wrong)
      failures.push({
        id: c.id,
        input: c.input.length > 80 ? `${c.input.slice(0, 80)}…` : c.input,
        expect: c.expect,
        got,
        wrong,
      });
  }

  const pct = ([ok, n]) => (n === 0 ? 100 : (100 * ok) / n);
  return {
    cases: singles.length,
    accuracy: Object.fromEntries(
      Object.entries(totals).map(([k, v]) => [k, { ok: v[0], total: v[1], pct: pct(v) }]),
    ),
    wrongFinancialTransactions: wft,
    failures,
  };
}

export function formatReport(report) {
  const lines = [`Holatlar: ${report.cases}`];
  for (const [k, v] of Object.entries(report.accuracy))
    lines.push(`  ${k.padEnd(9)} ${v.ok}/${v.total}  ${v.pct.toFixed(1)}%`);
  lines.push(`  WFT (noto'g'ri moliyaviy tranzaksiya): ${report.wrongFinancialTransactions}`);
  return lines.join('\n');
}

// ───────── Kontekstli va ko'p qadamli holatlar (resolver + policy + dialog) ─────────
import { normalizeName } from '@nasiya/shared';
import { IDLE, resolveCustomer, step } from '@nasiya/nlp';

/** golden `context` dan xotiradagi DialogEnv. */
export function makeEnv(context, parse) {
  const refs = context.customers.map((c, i) => ({
    id: `c${i}`,
    name: c.name,
    normalizedName: normalizeName(c.name),
    label: c.label ?? null,
    normalizedLabel: c.label ? normalizeName(c.label) : null,
    balance: c.balance,
    archived: Boolean(c.archived),
  }));
  const strip = ({ archived: _a, ...ref }) => ref;
  return {
    parse,
    writable: context.subscription !== 'EXPIRED',
    resolve: async (mention, alt) =>
      resolveCustomer(mention, alt, refs.filter((r) => !r.archived).map(strip)),
    getCustomer: async (id) => {
      const r = refs.find((x) => x.id === id);
      return r ? strip(r) : null;
    },
  };
}

/** expect dagi kontekst maydonlarini Decision bilan solishtiradi; nomuvofiqliklar ro'yxatini qaytaradi. */
export function compareDecision(expect, result, { turn = false } = {}) {
  const { decision } = result;
  const diffs = [];
  const check = (name, want, got) => {
    if (want === undefined) return;
    if (JSON.stringify(want) !== JSON.stringify(got ?? null))
      diffs.push(
        `${name}: kutilgan ${JSON.stringify(want)}, natija ${JSON.stringify(got ?? null)}`,
      );
  };
  check('action', expect.action, decision.action);
  check('pay_amount', expect.pay_amount, decision.amount);
  check('balance_after', expect.balance_after, decision.balanceAfter);
  check('max_payable', expect.max_payable, decision.maxPayable);
  check('candidate_count', expect.candidate_count, decision.candidates?.length);
  check('ask_label', expect.ask_label, decision.askLabel);
  check('balance', expect.balance, decision.balanceBefore);
  check('resolved_label', expect.resolved_label, decision.customer?.label);
  if (turn) {
    check('intent', expect.intent, decision.intent);
    check(
      'customer',
      expect.customer,
      decision.customer?.normalizedName ?? decision.newCustomerName,
    );
    check('amount', expect.amount, decision.amount);
    check(
      'superseded_previous',
      expect.superseded_previous,
      result.supersededPrevious || undefined,
    );
  }
  return diffs;
}

const draftIsWrong = (testCase, decision) => {
  if (!decision.draft) return false;
  if (testCase.no_draft) return true;
  const exp = testCase.expect;
  if (!exp) return false;
  const typeOk = exp.intent
    ? decision.draft.type === (exp.intent === 'CREATE_DEBT' ? 'DEBT' : 'PAYMENT')
    : true;
  const amount = exp.pay_amount ?? exp.amount;
  const amountOk =
    amount == null || exp.amount_kind === 'FULL' || exp.amount_kind === 'FRACTION'
      ? true
      : decision.draft.amount === amount;
  const dateOk =
    exp.date_offset_days === undefined || decision.draft.dateOffsetDays === exp.date_offset_days;
  return !(typeOk && amountOk && dateOk);
};

export async function evaluateContext(parse, golden = loadGolden()) {
  const failures = [];
  let wft = 0;
  let total = 0;

  for (const c of golden) {
    if (typeof c.input === 'string' && c.context) {
      total++;
      const env = makeEnv(c.context, parse);
      const parsed = await parse(c.input);
      const interp = compareSingle(c, parsed);
      const result = await step(IDLE, { type: 'text', text: c.input }, env);
      const diffs = compareDecision(c.expect, result);
      for (const [k, v] of Object.entries(interp.fields))
        if (v === false) diffs.push(`interpreter.${k}`);
      const wrong = draftIsWrong(c, result.decision);
      if (wrong) wft++;
      if (diffs.length || wrong) failures.push({ id: c.id, input: c.input, diffs, wrong });
    } else if (Array.isArray(c.turns)) {
      total++;
      const env = makeEnv(c.context, parse);
      let state = IDLE;
      const diffs = [];
      let wrong = false;
      for (const [i, turn] of c.turns.entries()) {
        const event = turn.button
          ? { type: 'button', id: turn.button }
          : { type: 'text', text: turn.input };
        const result = await step(state, event, env);
        state = result.state;
        for (const d of compareDecision(turn.expect, result, { turn: true }))
          diffs.push(`#${i + 1} ${turn.input ?? turn.button}: ${d}`);
        if (c.no_draft && result.decision.draft) wrong = true;
      }
      if (wrong) wft++;
      if (diffs.length || wrong)
        failures.push({
          id: c.id,
          input: c.turns.map((t) => t.input ?? `[${t.button}]`).join(' → '),
          diffs,
          wrong,
        });
    }
  }
  return { cases: total, wrongFinancialTransactions: wft, failures };
}
