-- 0001: asos. Kengaytmalar, umumiy funksiyalar va huquqlar siyosati.
--
-- Huquqlar siyosati (ADR-0002, ADR-0006): ilova roli (nasiya_app) yangi jadvallarda
-- DEFAULT holda faqat SELECT va INSERT oladi (append-only). UPDATE/DELETE har bir jadval
-- uchun alohida, ataylab beriladi. Shu tufayli ledger va audit o'zgarmas qoladi.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Hamma tashqi (PUBLIC) rollar uchun schema ichida jadval yaratish taqiqlanadi.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO nasiya_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT ON TABLES TO nasiya_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO nasiya_app;

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
