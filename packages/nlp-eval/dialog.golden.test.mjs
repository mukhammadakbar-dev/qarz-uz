import { parseRules } from '@nasiya/nlp';
import { describe, expect, it } from 'vitest';
import { evaluateContext } from './harness.mjs';

describe('Resolver + Policy + Dialog ↔ golden dataset (kontekstli va ko‘p qadamli holatlar)', () => {
  it('barcha holatlarda action va hisoblangan qiymatlar mos, WFT = 0', async () => {
    const report = await evaluateContext((text) => parseRules(text));
    const detail = report.failures
      .map((f) => `${f.wrong ? 'WFT ' : ''}${f.id} "${f.input}"\n    ${f.diffs.join('\n    ')}`)
      .join('\n');
    expect(detail, `\n${detail}`).toBe('');
    expect(report.wrongFinancialTransactions).toBe(0);
    expect(report.cases).toBeGreaterThan(55);
  });
});
