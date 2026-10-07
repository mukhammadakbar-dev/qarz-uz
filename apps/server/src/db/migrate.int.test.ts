import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_APP_URL, TEST_MIGRATOR_URL } from '../../test/env.js';
import { loadMigrations, runMigrations } from './migrate.js';
import { createPool, withTransaction } from './pool.js';

const realDir = fileURLToPath(new URL('../../migrations', import.meta.url));
let scratch: string;
let realNames: string[];
let next: string; // keyingi (hali yo'q) migratsiya raqami
let migrator: Pool;
let app: Pool;

beforeAll(async () => {
  realNames = (await loadMigrations(realDir)).map((m) => m.name);
  next = String(realNames.length + 1).padStart(4, '0');
  scratch = await mkdtemp(join(tmpdir(), 'nasiya-mig-int-'));
  await cp(realDir, scratch, { recursive: true });
  migrator = createPool(TEST_MIGRATOR_URL, { max: 2 });
  app = createPool(TEST_APP_URL, { max: 2 });
});

afterAll(async () => {
  await migrator.query('DROP TABLE IF EXISTS tmp_priv, tmp_fail');
  await migrator.query(
    "DELETE FROM schema_migrations WHERE name LIKE '%\\_tmp\\_%' OR name LIKE '%\\_ghost%'",
  );
  await Promise.all([migrator.end(), app.end()]);
  await rm(scratch, { recursive: true, force: true });
});

describe('runMigrations (real Postgres)', () => {
  it('global setup hamma migratsiyalarni qo‘llagan, qayta ishga tushirish hech narsa qilmaydi', async () => {
    const applied = await runMigrations({ connectionString: TEST_MIGRATOR_URL, dir: realDir });
    expect(applied).toEqual([]);
    const { rows } = await migrator.query('SELECT name FROM schema_migrations ORDER BY name');
    expect(rows.map((r) => r.name)).toEqual(realNames);
  });

  it('pg_trgm kengaytmasi va set_updated_at funksiyasi mavjud', async () => {
    const ext = await migrator.query("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'");
    const fn = await migrator.query("SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at'");
    expect(ext.rowCount).toBe(1);
    expect(fn.rowCount).toBe(1);
  });

  it('qo‘llangan migratsiya o‘zgartirilsa to‘xtaydi', async () => {
    const original = await readFile(join(scratch, '0001_init.sql'), 'utf8');
    await writeFile(join(scratch, '0001_init.sql'), `${original}\n-- tahrir`);
    await expect(
      runMigrations({ connectionString: TEST_MIGRATOR_URL, dir: scratch }),
    ).rejects.toThrow(/o'zgartirilgan/);
    await writeFile(join(scratch, '0001_init.sql'), original);
  });

  it('xato migratsiya to‘liq ROLLBACK bo‘ladi', async () => {
    await writeFile(
      join(scratch, `${next}_tmp_fail.sql`),
      'CREATE TABLE tmp_fail (id int); SELECT 1/0;',
    );
    await expect(
      runMigrations({ connectionString: TEST_MIGRATOR_URL, dir: scratch }),
    ).rejects.toThrow(/_tmp_fail/);
    const t = await migrator.query("SELECT to_regclass('public.tmp_fail') AS t");
    expect(t.rows[0].t).toBeNull();
    const m = await migrator.query(
      "SELECT 1 FROM schema_migrations WHERE name LIKE '%\\_tmp\\_fail%'",
    );
    expect(m.rowCount).toBe(0);
    await rm(join(scratch, `${next}_tmp_fail.sql`));
  });

  it('fayli yo‘qolgan qo‘llangan migratsiyani aniqlaydi', async () => {
    await migrator.query(
      `INSERT INTO schema_migrations (name, checksum) VALUES ('${next}_ghost.sql', 'x')`,
    );
    await expect(
      runMigrations({ connectionString: TEST_MIGRATOR_URL, dir: realDir }),
    ).rejects.toThrow(/topilmadi/);
    await migrator.query(`DELETE FROM schema_migrations WHERE name = '${next}_ghost.sql'`);
  });
});

describe('huquqlar siyosati (append-only default)', () => {
  it('yangi jadvalda app roli faqat SELECT/INSERT oladi', async () => {
    await writeFile(
      join(scratch, `${next}_tmp_priv.sql`),
      'CREATE TABLE tmp_priv (id int, v text);',
    );
    await runMigrations({ connectionString: TEST_MIGRATOR_URL, dir: scratch });

    await app.query("INSERT INTO tmp_priv (id, v) VALUES (1, 'a')");
    const sel = await app.query('SELECT * FROM tmp_priv');
    expect(sel.rowCount).toBe(1);
    await expect(app.query("UPDATE tmp_priv SET v = 'b'")).rejects.toThrow(/permission denied/);
    await expect(app.query('DELETE FROM tmp_priv')).rejects.toThrow(/permission denied/);
  });

  it('app roli jadval yarata olmaydi', async () => {
    await expect(app.query('CREATE TABLE evil (id int)')).rejects.toThrow(/permission denied/);
  });

  it('app roli RLS ni chetlab o‘tolmaydi (BYPASSRLS yo‘q, superuser emas)', async () => {
    const { rows } = await app.query(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });
});

describe('withTransaction', () => {
  it('xatoda ROLLBACK qiladi', async () => {
    await expect(
      withTransaction(app, async (c) => {
        await c.query("INSERT INTO tmp_priv (id, v) VALUES (2, 'rollback')");
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const { rowCount } = await app.query("SELECT 1 FROM tmp_priv WHERE v = 'rollback'");
    expect(rowCount).toBe(0);
  });

  it('muvaffaqiyatda COMMIT qiladi va natijani qaytaradi', async () => {
    const out = await withTransaction(app, async (c) => {
      await c.query("INSERT INTO tmp_priv (id, v) VALUES (3, 'commit')");
      return 42;
    });
    expect(out).toBe(42);
    const { rowCount } = await app.query("SELECT 1 FROM tmp_priv WHERE v = 'commit'");
    expect(rowCount).toBe(1);
  });
});
