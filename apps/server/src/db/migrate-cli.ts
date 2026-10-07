import { fileURLToPath } from 'node:url';
import { runMigrations } from './migrate.js';

// Migratsiya faqat MIGRATOR_DATABASE_URL ni talab qiladi (to'liq konfiguratsiya shart emas).
const url = process.env['MIGRATOR_DATABASE_URL'];
if (!url) {
  process.stderr.write('MIGRATOR_DATABASE_URL berilmagan\n');
  process.exit(1);
}

try {
  const applied = await runMigrations({
    connectionString: url,
    dir: fileURLToPath(new URL('../../migrations', import.meta.url)),
    log: (m) => process.stdout.write(`${m}\n`),
  });
  process.stdout.write(`tayyor (${applied.length} ta yangi)\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
