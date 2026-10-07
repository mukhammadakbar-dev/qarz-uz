import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadMigrations, MigrationError } from './migrate.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nasiya-mig-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('loadMigrations', () => {
  it('fayllarni tartib bilan yuklaydi va checksum hisoblaydi', async () => {
    await writeFile(join(dir, '0002_b.sql'), 'SELECT 2;');
    await writeFile(join(dir, '0001_a.sql'), 'SELECT 1;');
    await writeFile(join(dir, 'README.md'), "e'tiborsiz");
    const m = await loadMigrations(dir);
    expect(m.map((x) => x.name)).toEqual(['0001_a.sql', '0002_b.sql']);
    expect(m[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(m[0]?.checksum).not.toBe(m[1]?.checksum);
  });

  it('raqamlar orasida bo‘shliq bo‘lsa rad etadi', async () => {
    await writeFile(join(dir, '0001_a.sql'), 'SELECT 1;');
    await writeFile(join(dir, '0003_c.sql'), 'SELECT 3;');
    await expect(loadMigrations(dir)).rejects.toThrow(MigrationError);
  });

  it('noto‘g‘ri fayl nomini rad etadi', async () => {
    await writeFile(join(dir, 'init.sql'), 'SELECT 1;');
    await expect(loadMigrations(dir)).rejects.toThrow(/fayl nomi/);
  });

  it('takroriy raqamni rad etadi', async () => {
    await writeFile(join(dir, '0001_a.sql'), 'SELECT 1;');
    await writeFile(join(dir, '0001_b.sql'), 'SELECT 2;');
    await expect(loadMigrations(dir)).rejects.toThrow(MigrationError);
  });

  it('haqiqiy migratsiyalar papkasi to‘g‘ri tartiblangan', async () => {
    const real = new URL('../../migrations', import.meta.url);
    const m = await loadMigrations(real.pathname);
    expect(m.length).toBeGreaterThan(0);
    expect(m[0]?.name).toBe('0001_init.sql');
  });
});
