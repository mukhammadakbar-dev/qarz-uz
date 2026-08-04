import { readFileSync, existsSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { pool } from './pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Records which migration files have already run.
 *
 * Every migration was previously re-executed on each deploy. That is survivable
 * while they are all written defensively (IF NOT EXISTS / ADD COLUMN IF NOT
 * EXISTS), but it is a trap: the first migration needing a real data change — a
 * backfill, a rename, a one-way UPDATE — would silently run again on every
 * deploy. A ledger also makes it possible to see what a given database has had
 * applied to it.
 */
const ensureLedger = (client) =>
  client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

const run = async () => {
  const client = await pool.connect();
  try {
    // 1) base schema (idempotent: CREATE TABLE IF NOT EXISTS everywhere)
    const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
    console.log('[migrate] Applying base schema...');
    await client.query(sql);

    await ensureLedger(client);

    // 2) incremental migrations, applied in filename order, once each
    const dir = join(__dirname, 'migrations');
    if (existsSync(dir)) {
      const applied = new Set(
        (await client.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename)
      );
      const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

      for (const f of files) {
        if (applied.has(f)) {
          console.log(`[migrate] Skipping ${f} (already applied)`);
          continue;
        }
        console.log(`[migrate] Applying ${f}...`);
        // Each migration is its own transaction: a failure rolls that file back
        // and leaves the ledger untouched, so a corrected migration can be retried.
        await client.query('BEGIN');
        try {
          await client.query(readFileSync(join(dir, f), 'utf-8'));
          await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [f]);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw new Error(`Migration ${f} failed: ${err.message}`, { cause: err });
        }
      }
    }

    console.log('[migrate] Done ✔');
  } finally {
    client.release();
    // Always close the pool, including on failure — the previous version left
    // the process hanging on an open pool whenever a migration threw.
    await pool.end();
  }
};

run().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
