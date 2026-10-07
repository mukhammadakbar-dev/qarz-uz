import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from 'pg';

/**
 * Oddiy, oldinga ketuvchi (forward-only) SQL migratsiya runner (ADR-0001).
 *  - Fayl nomi: `0001_nom.sql`, raqamlar ketma-ket, bo'shliqsiz.
 *  - Har bir migratsiya o'z tranzaksiyasida bajariladi (CREATE INDEX CONCURRENTLY kabi
 *    tranzaksiyaga sig'maydigan buyruqlar qo'llab-quvvatlanmaydi).
 *  - Qo'llangan migratsiya fayli keyin o'zgartirilsa (checksum), runner to'xtaydi.
 *  - Parallel ishga tushirishdan advisory lock himoya qiladi.
 */

export interface Migration {
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

const FILE_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;
const LOCK_KEY = 'nasiya:migrate';

export async function loadMigrations(dir: string): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).toSorted();
  const migrations: Migration[] = [];
  let expected = 1;
  for (const file of files) {
    const match = FILE_PATTERN.exec(file);
    if (!match) throw new MigrationError(`Migratsiya fayl nomi noto'g'ri: ${file}`);
    const seq = Number(match[1]);
    if (seq !== expected) {
      throw new MigrationError(
        `Migratsiya raqami ketma-ket emas: kutilgan ${String(expected).padStart(4, '0')}, topilgan ${file}`,
      );
    }
    expected++;
    const sql = await readFile(join(dir, file), 'utf8');
    migrations.push({
      name: file,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    });
  }
  return migrations;
}

export interface MigrateOptions {
  readonly connectionString: string;
  readonly dir: string;
  readonly log?: (message: string) => void;
}

/** Qo'llangan migratsiya nomlarini qaytaradi (yangi qo'llanganlar). */
export async function runMigrations(options: MigrateOptions): Promise<string[]> {
  const log = options.log ?? (() => undefined);
  const migrations = await loadMigrations(options.dir);
  const client = new Client({
    connectionString: options.connectionString,
    application_name: 'nasiya-migrate',
  });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);

    const { rows } = await client.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM schema_migrations ORDER BY name',
    );
    const applied = new Map(rows.map((r) => [r.name, r.checksum]));
    const known = new Set(migrations.map((m) => m.name));

    for (const name of applied.keys()) {
      if (!known.has(name)) {
        throw new MigrationError(`Bazada qo'llangan migratsiya fayli topilmadi: ${name}`);
      }
    }
    for (const m of migrations) {
      const checksum = applied.get(m.name);
      if (checksum !== undefined && checksum !== m.checksum) {
        throw new MigrationError(
          `Qo'llangan migratsiya o'zgartirilgan: ${m.name}. Yangi migratsiya yozing, eskisini tahrirlamang.`,
        );
      }
    }

    const done: string[] = [];
    for (const m of migrations) {
      if (applied.has(m.name)) continue;
      log(`qo'llanmoqda: ${m.name}`);
      try {
        await client.query('BEGIN');
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
          m.name,
          m.checksum,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new MigrationError(
          `${m.name} bajarilmadi: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      done.push(m.name);
    }
    if (done.length === 0) log('yangi migratsiya yo‘q');
    return done;
  } finally {
    await client
      .query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY])
      .catch(() => undefined);
    await client.end();
  }
}
