import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { runMigrations } from '../src/db/migrate.js';
import { TEST_MIGRATOR_URL } from './env.js';

/**
 * Har test yurishidan oldin test DB ni tozalaydi va migratsiyalarni noldan qo'llaydi.
 * `DROP OWNED BY` migrator roli yaratgan hamma narsani (jadval, kengaytma, default huquqlar) o'chiradi.
 */
export default async function setup(): Promise<void> {
  const client = new Client({ connectionString: TEST_MIGRATOR_URL });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `Test DB ga ulanib bo'lmadi (${TEST_MIGRATOR_URL.replace(/:[^:@]*@/, ':***@')}). ` +
        `\`scripts/dev-db.sh up\` ni ishga tushiring.`,
      { cause: error },
    );
  }
  try {
    await client.query('DROP OWNED BY nasiya_migrator CASCADE');
  } finally {
    await client.end();
  }
  await runMigrations({
    connectionString: TEST_MIGRATOR_URL,
    dir: fileURLToPath(new URL('../migrations', import.meta.url)),
  });
}
