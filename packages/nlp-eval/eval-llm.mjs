#!/usr/bin/env node
// Haqiqiy Gemini bilan baholash — MODEL TANLASH uchun (ADR-0004 §5: aniqlik ustuvor, narx ikkinchi).
//
//   GEMINI_API_KEY=... GEMINI_MODEL=<model-nomi> pnpm --filter @nasiya/nlp-eval eval:llm
//
// Golden datasetning kontekstsiz holatlarini: (a) faqat rule, (b) faqat LLM (xom), (c) birlashtirilgan (production
// yo'li) bo'yicha solishtiradi. Muvaffaqiyat mezoni: birlashtirilgan natijada WFT = 0.
// Eslatma: bu skript tashqi API ga so'rov yuboradi (golden matnlar, PII yo'q).
import { mergeIntents, parseRules, redactPii } from '@nasiya/nlp';
import { normalizeName } from '@nasiya/shared';
import {
  createGeminiGenerate,
  createGeminiProvider,
} from '../../apps/server/src/modules/interpretation/gemini.ts';
import { compareSingle, loadGolden } from './harness.mjs';

const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL;
if (!apiKey || !model) {
  console.error('GEMINI_API_KEY va GEMINI_MODEL kerak');
  process.exit(2);
}

const provider = createGeminiProvider({
  generate: createGeminiGenerate(apiKey, model, process.env.GEMINI_THINKING_LEVEL ?? 'MINIMAL'),
  model,
  timeoutMs: 15000,
  retries: 1,
});
const cases = loadGolden().filter((c) => typeof c.input === 'string' && !c.context);
const limit = Number(process.env.EVAL_LIMIT ?? cases.length);
// Bepul tarifda daqiqalik limit kichik: so'rovlar orasida pauza (ms)
const pauseMs = Number(process.env.EVAL_PAUSE_MS ?? 0);
const concurrency = Number(process.env.EVAL_CONCURRENCY ?? 4);

const rows = [];
let next = 0;
async function worker() {
  while (next < Math.min(limit, cases.length)) {
    const c = cases[next++];
    const call = await provider.interpret(redactPii(c.input));
    rows.push({ c, call });
    if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));

const toGot = (r) => ({
  intent: r.intent,
  // LLM ismni Kirillda qaytarishi mumkin: production resolver kabi normalizatsiyadan keyin solishtiriladi
  customer: r.customer ? normalizeName(r.customer) : null,
  amount: r.amount,
  amountKind: r.amountKind,
  fraction: r.fraction,
  dateOffsetDays: r.dateOffsetDays,
});
const tally = () => ({ ok: 0, n: 0, wft: 0 });
const stats = { rules: tally(), llm: tally(), merged: tally() };
const agreements = {};
const errors = {};
const failures = [];

for (const { c, call } of rows) {
  const rule = parseRules(c.input);
  const merged = mergeIntents(rule, call.intent);
  agreements[merged.agreement] = (agreements[merged.agreement] ?? 0) + 1;
  if (call.error) errors[call.error] = (errors[call.error] ?? 0) + 1;

  const evalOne = (name, got) => {
    const { fields, wrong } = compareSingle(c, got);
    const vals = Object.values(fields).filter((v) => v !== null);
    stats[name].n++;
    if (vals.every(Boolean)) stats[name].ok++;
    if (wrong) stats[name].wft++;
    return { fields, wrong };
  };
  evalOne('rules', rule);
  if (call.intent) {
    const raw = evalOne('llm', toGot(call.intent));
    // EVAL_SHOW_LLM=1: xom LLM xatolarini ko'rsatish (qaysi maydon noto'g'ri — tizimli xatoni topish uchun)
    if (process.env.EVAL_SHOW_LLM && raw.wrong)
      console.log(
        '△ LLM',
        c.id,
        JSON.stringify(c.input),
        '\n   kutilgan:',
        JSON.stringify(c.expect),
        '\n   LLM:',
        JSON.stringify(toGot(call.intent)),
        '\n   maydonlar:',
        JSON.stringify(raw.fields),
      );
  }
  const m = evalOne('merged', merged.parsed);
  if (m.wrong)
    failures.push({
      id: c.id,
      input: c.input,
      expect: c.expect,
      got: merged.parsed,
      llm: call.intent,
      agreement: merged.agreement,
    });
}

const latencies = rows.map((r) => r.call.latencyMs).toSorted((a, b) => a - b);
const pct = (p) =>
  latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))] ?? 0;
const fmt = (s) =>
  `${s.ok}/${s.n} to'liq mos (${((100 * s.ok) / Math.max(1, s.n)).toFixed(1)}%), WFT=${s.wft}`;

console.log(`Model: ${model}   holatlar: ${rows.length}`);
console.log(`  faqat rule:     ${fmt(stats.rules)}`);
console.log(`  faqat LLM (xom): ${fmt(stats.llm)}`);
console.log(`  birlashtirilgan: ${fmt(stats.merged)}   <- production yo'li`);
console.log('  kelishuv:', JSON.stringify(agreements));
console.log('  LLM xatolari:', JSON.stringify(errors));
console.log(`  kechikish: p50=${pct(50)} ms, p95=${pct(95)} ms`);
for (const f of failures.slice(0, 20))
  console.log(
    '\n✗ WFT',
    f.id,
    JSON.stringify(f.input),
    '\n   kutilgan:',
    JSON.stringify(f.expect),
    '\n   LLM:',
    JSON.stringify(f.llm),
    '\n   natija:',
    JSON.stringify({ intent: f.got.intent, customer: f.got.customer, amount: f.got.amount }),
    f.agreement,
  );
process.exit(stats.merged.wft > 0 ? 1 : 0);
