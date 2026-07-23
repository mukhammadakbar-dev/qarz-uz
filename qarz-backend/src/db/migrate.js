import { readFileSync, existsSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { pool } from './pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const run = async () => {
  // 1) base schema (idempotent: CREATE TABLE IF NOT EXISTS everywhere)
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  console.log('[migrate] Applying base schema...');
  await pool.query(sql);

  // 2) incremental migrations, applied in filename order
  const dir = join(__dirname, 'migrations');
  if (existsSync(dir)) {
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      console.log(`[migrate] Applying ${f}...`);
      await pool.query(readFileSync(join(dir, f), 'utf-8'));
    }
  }

  console.log('[migrate] Done ✔');
  await pool.end();
};

run().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
