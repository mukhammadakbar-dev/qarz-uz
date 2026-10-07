import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTIONS, INTENTS } from '@nasiya/shared';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const run = (script, ...args) =>
  spawnSync(process.execPath, [join(here, script), ...args], { encoding: 'utf8' });

const cases = readFileSync(join(here, 'golden.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));

describe('golden dataset', () => {
  it('generatordan chiqqan natijaga teng (qo‘lda tahrir qilinmagan)', () => {
    const r = run('build-golden.mjs', '--check');
    expect(r.status, r.stderr).toBe(0);
  });

  it('validator xatosiz o‘tadi', () => {
    const r = run('validate-golden.mjs');
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });

  it('intent va action to‘plamlari @nasiya/shared bilan mos', () => {
    const intents = new Set();
    const actions = new Set();
    for (const c of cases) {
      if (c.expect?.intent) intents.add(c.expect.intent);
      if (c.expect?.action) actions.add(c.expect.action);
      for (const t of c.turns ?? []) actions.add(t.expect.action);
    }
    expect([...intents].every((i) => INTENTS.includes(i))).toBe(true);
    expect([...actions].every((a) => ACTIONS.includes(a))).toBe(true);
    // Hamma action'lar golden'da qamralgan bo‘lishi shart
    expect(ACTIONS.filter((a) => !actions.has(a))).toEqual([]);
  });
});
