-- Dev konteyner birinchi ishga tushganda bir marta bajariladi (superuser sifatida).
-- Rollar (ADR-0001, ADR-0002):
--   nasiya_migrator — DB egasi, migratsiyalarni bajaradi, jadvallarga egalik qiladi
--   nasiya_app      — ilova roli: BYPASSRLS yo'q, faqat kerakli huquqlar
--   nasiya_system   — cron va superadmin billing uchun: BYPASSRLS, alohida pool

CREATE ROLE nasiya_migrator LOGIN PASSWORD 'nasiya_migrator' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE nasiya_app LOGIN PASSWORD 'nasiya_app' NOSUPERUSER NOBYPASSRLS;
-- Cross-tenant ishlar (cron, superadmin billing): RLS ni chetlab o'tadi, faqat shu maqsadda ishlatiladi
CREATE ROLE nasiya_system LOGIN PASSWORD 'nasiya_system' NOSUPERUSER BYPASSRLS;

CREATE DATABASE nasiya OWNER nasiya_migrator;
CREATE DATABASE nasiya_test OWNER nasiya_migrator;

\connect nasiya
REVOKE ALL ON DATABASE nasiya FROM PUBLIC;
GRANT CONNECT ON DATABASE nasiya TO nasiya_app, nasiya_system;

\connect nasiya_test
REVOKE ALL ON DATABASE nasiya_test FROM PUBLIC;
GRANT CONNECT ON DATABASE nasiya_test TO nasiya_app, nasiya_system;
