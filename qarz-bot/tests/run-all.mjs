// Test runner: executes every tests/*_test.mjs in its own process (they each
// monkey-patch pg.Pool globally, so they cannot share one) and fails the run if
// any of them reports a FAIL line or exits non-zero.
import { readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawnSync } from 'child_process';

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here).filter((f) => f.endsWith('_test.mjs')).sort();

let totalPass = 0;
let totalFail = 0;
const broken = [];

for (const f of files) {
  const res = spawnSync(process.execPath, [join(here, f)], { encoding: 'utf8' });
  const out = `${res.stdout}${res.stderr}`;
  const pass = (out.match(/^PASS/gm) || []).length;
  const fail = (out.match(/^FAIL/gm) || []).length;
  totalPass += pass;
  totalFail += fail;

  const crashed = res.status !== 0 && fail === 0;
  const ok = fail === 0 && !crashed;
  console.log(`${ok ? '✓' : '✗'} ${f.padEnd(28)} ${pass} passed${fail ? `, ${fail} FAILED` : ''}${crashed ? ' (crashed)' : ''}`);

  if (!ok) {
    broken.push(f);
    for (const line of out.split('\n').filter((l) => l.startsWith('FAIL'))) {
      console.log(`    ${line}`);
    }
    if (crashed) console.log(out.split('\n').slice(-15).map((l) => `    ${l}`).join('\n'));
  }
}

console.log(`\n${files.length} suites — ${totalPass} passed, ${totalFail} failed`);
if (broken.length) {
  console.log(`Failing suites: ${broken.join(', ')}`);
  process.exit(1);
}
