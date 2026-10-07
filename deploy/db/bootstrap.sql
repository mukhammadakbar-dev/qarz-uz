-- Production uchun DB, rollar va asosiy huquqlarni yaratadi (bir marta; qayta ishga tushirsa parollarni yangilaydi).
-- Superuser sifatida ishga tushiring. Parollar env orqali beriladi (ps ro'yxatida ko'rinmasligi uchun):
--
--   export NASIYA_MIGRATOR_PW=... NASIYA_APP_PW=... NASIYA_SYSTEM_PW=...   # openssl rand -hex 24
--   sudo -u postgres -E psql -v ON_ERROR_STOP=1 -f deploy/db/bootstrap.sql
--   (ixtiyoriy: -v dbname=nasiya)
--
-- Rollar (ADR-0001, ADR-0006):
--   nasiya_migrator — DB egasi, faqat migratsiyalar uchun (ilova ishlayotganda ulanmaydi)
--   nasiya_app      — ilova: BYPASSRLS yo'q
--   nasiya_system   — cron va superadmin billing: BYPASSRLS

\set ON_ERROR_STOP on
\if :{?dbname}
\else
  \set dbname nasiya
\endif
\set migrator_pw `printenv NASIYA_MIGRATOR_PW`
\set app_pw `printenv NASIYA_APP_PW`
\set system_pw `printenv NASIYA_SYSTEM_PW`

-- Parol berilmagan bo'lsa to'xtaymiz (bo'sh parol bilan rol yaratmaslik uchun)
SELECT (:'migrator_pw' = '' OR :'app_pw' = '' OR :'system_pw' = '') AS missing_passwords \gset
\if :missing_passwords
  -- ON_ERROR_STOP tufayli psql noldan farqli kod bilan chiqadi
  DO $$ BEGIN RAISE EXCEPTION 'NASIYA_MIGRATOR_PW, NASIYA_APP_PW va NASIYA_SYSTEM_PW berilishi shart'; END $$;
\endif

SELECT format('CREATE ROLE nasiya_migrator LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS', :'migrator_pw')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nasiya_migrator') \gexec
SELECT format('ALTER ROLE nasiya_migrator PASSWORD %L', :'migrator_pw')
 WHERE EXISTS (SELECT FROM pg_roles WHERE rolname = 'nasiya_migrator') \gexec

SELECT format('CREATE ROLE nasiya_app LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS', :'app_pw')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nasiya_app') \gexec
SELECT format('ALTER ROLE nasiya_app PASSWORD %L', :'app_pw')
 WHERE EXISTS (SELECT FROM pg_roles WHERE rolname = 'nasiya_app') \gexec

SELECT format('CREATE ROLE nasiya_system LOGIN PASSWORD %L NOSUPERUSER BYPASSRLS', :'system_pw')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nasiya_system') \gexec
SELECT format('ALTER ROLE nasiya_system PASSWORD %L', :'system_pw')
 WHERE EXISTS (SELECT FROM pg_roles WHERE rolname = 'nasiya_system') \gexec

SELECT format('CREATE DATABASE %I OWNER nasiya_migrator', :'dbname')
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'dbname') \gexec

SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'dbname') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO nasiya_app, nasiya_system', :'dbname') \gexec

\echo 'Tayyor. Keyingi qadam: migratsiyalar (MIGRATOR_DATABASE_URL bilan `pnpm --filter @nasiya/server migrate:prod`).'
