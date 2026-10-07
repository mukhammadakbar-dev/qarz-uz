#!/usr/bin/env node
// Ishlatish: node packages/nlp-eval/eval.mjs  (yoki: pnpm eval) — hisobotni chiqaradi, xato bo'lsa batafsil.
import { parseRules } from '@nasiya/nlp';
import { evaluateContext, evaluateInterpreter, formatReport } from './harness.mjs';

const report = evaluateInterpreter((text) => parseRules(text));
console.log(formatReport(report));
for (const f of report.failures) {
  console.log(`\n${f.wrong ? '✗ WFT' : '✗'} ${f.id} ${JSON.stringify(f.input)}`);
  console.log('   kutilgan:', JSON.stringify(f.expect));
  console.log(
    '   natija:  ',
    JSON.stringify({
      intent: f.got.intent,
      customer: f.got.customer,
      amount: f.got.amount,
      kind: f.got.amountKind,
      fraction: f.got.fraction,
      date: f.got.dateOffsetDays,
      phone: f.got.phone,
      reason: f.got.reason,
    }),
  );
}

const ctx = await evaluateContext((text) => parseRules(text));
console.log(
  `\nKontekstli va ko'p qadamli: ${ctx.cases} holat, WFT = ${ctx.wrongFinancialTransactions}`,
);
for (const f of ctx.failures) {
  console.log(`\n${f.wrong ? '✗ WFT' : '✗'} ${f.id} ${JSON.stringify(f.input)}`);
  for (const d of f.diffs) console.log('   ', d);
}
process.exit(report.failures.length || ctx.failures.length ? 1 : 0);
