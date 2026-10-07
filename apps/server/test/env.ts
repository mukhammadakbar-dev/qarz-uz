// Integratsion testlar uchun ulanish satrlari (scripts/dev-db.sh yaratgan test DB).
export const TEST_APP_URL =
  process.env['TEST_DATABASE_URL'] ??
  'postgres://nasiya_app:nasiya_app@localhost:55432/nasiya_test';
export const TEST_MIGRATOR_URL =
  process.env['TEST_MIGRATOR_DATABASE_URL'] ??
  'postgres://nasiya_migrator:nasiya_migrator@localhost:55432/nasiya_test';
export const TEST_SYSTEM_URL =
  process.env['TEST_SYSTEM_DATABASE_URL'] ??
  'postgres://nasiya_system:nasiya_system@localhost:55432/nasiya_test';
