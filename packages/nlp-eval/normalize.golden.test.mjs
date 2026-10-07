import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeText } from '@nasiya/shared';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const cases = readFileSync(join(here, 'golden.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));

describe('normalizeText ↔ golden dataset', () => {
  it('har bir kontekstsiz holatda normallangan matn kutilgan ismni o‘z ichiga oladi', () => {
    const failures = [];
    let checked = 0;
    for (const c of cases) {
      if (typeof c.input !== 'string' || !c.expect?.customer) continue;
      checked++;
      const normalized = normalizeText(c.input);
      if (!normalized.includes(c.expect.customer)) {
        failures.push(`${c.id}: "${c.input}" → "${normalized}" (kutilgan: ${c.expect.customer})`);
      }
    }
    expect(checked).toBeGreaterThan(300);
    expect(failures).toEqual([]);
  });

  it('AC-04 guruhi: uchala yozuv bir xil normallanadi', () => {
    const texts = cases.filter((c) => c.group === 'AC-04').map((c) => normalizeText(c.input));
    expect(texts).toHaveLength(3);
    expect(new Set(texts).size).toBe(1);
  });

  it('TT §20: summa shakllari (Lotin va Kirill) bir xil qiymatga keladi', () => {
    // Kirill "минг/к" Lotin "ming/k" ga o‘tgach, Lotin variantlar bilan bir xil bo‘lishi kerak
    expect(normalizeText('Murod 50 минг')).toBe(normalizeText('Murod 50 ming'));
    expect(normalizeText('Murod 50минг')).toBe(normalizeText('Murod 50ming'));
    expect(normalizeText('Murod 50к')).toBe(normalizeText('Murod 50k'));
  });

  it('TT §20 ism guruhi: barcha yozuvlar "murod" ni beradi', () => {
    const names = cases
      .filter((c) => c.group === 'TT20-NAME')
      .map((c) => normalizeText(c.input).replace(' 50 ming', ''));
    expect(names).toHaveLength(5);
    expect(new Set(names)).toEqual(new Set(['murod']));
  });
});
