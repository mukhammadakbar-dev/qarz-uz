import { parseRules } from '@nasiya/nlp';
import { describe, expect, it } from 'vitest';
import { evaluateInterpreter, formatReport } from './harness.mjs';

describe('RuleProvider ↔ golden dataset (kontekstsiz holatlar)', () => {
  const report = evaluateInterpreter((text) => parseRules(text));

  it('wrong financial transaction = 0', () => {
    const wrong = report.failures.filter((f) => f.wrong);
    expect(wrong.map((f) => `${f.id}: ${f.input}`)).toEqual([]);
    expect(report.wrongFinancialTransactions).toBe(0);
  });

  it('barcha maydonlar bo‘yicha 100% (rule parser golden v0 ni to‘liq qoplaydi)', () => {
    const detail = report.failures
      .map(
        (f) =>
          `${f.id} "${f.input}"\n    kutilgan: ${JSON.stringify(f.expect)}\n    natija:   ${JSON.stringify({ intent: f.got.intent, customer: f.got.customer, amount: f.got.amount, kind: f.got.amountKind, fraction: f.got.fraction, date: f.got.dateOffsetDays, reason: f.got.reason })}`,
      )
      .join('\n');
    expect(detail, `\n${formatReport(report)}\n${detail}`).toBe('');
  });
});
