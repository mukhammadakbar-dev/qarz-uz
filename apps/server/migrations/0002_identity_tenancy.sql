-- 0002: identity va tenancy (users, businesses, business_members, invites) + RLS asoslari.
--
-- RLS (ADR-0006): har bir tranzaksiya boshida ilova `app.business_id` va `app.user_id` ni
-- `set_config(..., true)` bilan o'rnatadi. O'rnatilmagan bo'lsa funksiyalar NULL qaytaradi va
-- hech qanday qator ko'rinmaydi (fail-closed). FORCE ishlatilmaydi: jadval egasi (migrator) va
-- SECURITY DEFINER funksiyalar RLS ni chetlab o'tadi; migrator ilova ishlayotganda ishlatilmaydi.
-- Cross-tenant ishlar (cron, billing admin) uchun alohida BYPASSRLS roli: nasiya_system.

GRANT USAGE ON SCHEMA public TO nasiya_system;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT ON TABLES TO nasiya_system;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO nasiya_system;

CREATE FUNCTION app_business_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.business_id', true), '')::uuid
$$;

CREATE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

-- Append-only jadvallar uchun: UPDATE/DELETE/TRUNCATE hech kimga (egasiga ham) ruxsat etilmaydi.
CREATE FUNCTION forbid_modification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% jadvali o''zgarmas (append-only): % taqiqlangan', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

-- ───────── users (global identity; RLS yo'q, faqat `identity` moduli murojaat qiladi) ─────────
CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id   bigint NOT NULL UNIQUE,
  username           text,
  first_name         text,
  last_name          text,
  locale             text NOT NULL DEFAULT 'uz-Latn' CHECK (locale IN ('uz-Latn', 'uz-Cyrl')),
  active_business_id uuid,
  trial_used_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
GRANT UPDATE ON users TO nasiya_app, nasiya_system;
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ───────── businesses ─────────
CREATE TABLE businesses (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  short_code              text NOT NULL UNIQUE CHECK (short_code ~ '^TD-[A-HJ-NP-Z2-9]{4,6}$'),
  owner_user_id           uuid NOT NULL REFERENCES users (id),
  currency                text NOT NULL DEFAULT 'UZS' CHECK (currency ~ '^[A-Z]{3}$'),
  timezone                text NOT NULL DEFAULT 'Asia/Tashkent',
  notify_owner_on_delete  boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX businesses_owner_idx ON businesses (owner_user_id);
GRANT UPDATE ON businesses TO nasiya_app, nasiya_system;
CREATE TRIGGER businesses_set_updated_at BEFORE UPDATE ON businesses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE users
  ADD CONSTRAINT users_active_business_fk
  FOREIGN KEY (active_business_id) REFERENCES businesses (id) ON DELETE SET NULL;

-- ───────── business_members ─────────
CREATE TABLE business_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users (id),
  role        text NOT NULL CHECK (role IN ('OWNER', 'STAFF')),
  status      text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz,
  UNIQUE (business_id, user_id),
  CONSTRAINT business_members_revoked_consistency
    CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
);
CREATE INDEX business_members_user_idx ON business_members (user_id) WHERE status = 'ACTIVE';
GRANT UPDATE ON business_members TO nasiya_app, nasiya_system;

-- ───────── invites (staff taklifi; token faqat hash ko'rinishida saqlanadi) ─────────
CREATE TABLE invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  role        text NOT NULL DEFAULT 'STAFF' CHECK (role = 'STAFF'),
  expires_at  timestamptz NOT NULL,
  created_by  uuid NOT NULL REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  used_by     uuid REFERENCES users (id),
  used_at     timestamptz,
  CONSTRAINT invites_used_consistency CHECK ((used_by IS NULL) = (used_at IS NULL))
);
CREATE INDEX invites_business_idx ON invites (business_id, created_at DESC);

-- ───────── RLS policy'lar ─────────
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
CREATE POLICY businesses_select ON businesses FOR SELECT USING (
  id = app_business_id()
  OR EXISTS (
    SELECT 1 FROM business_members m
    WHERE m.business_id = businesses.id AND m.user_id = app_user_id() AND m.status = 'ACTIVE'
  )
);
CREATE POLICY businesses_insert ON businesses FOR INSERT WITH CHECK (id = app_business_id());
CREATE POLICY businesses_update ON businesses FOR UPDATE
  USING (id = app_business_id()) WITH CHECK (id = app_business_id());

ALTER TABLE business_members ENABLE ROW LEVEL SECURITY;
-- Foydalanuvchi o'z a'zoliklarini (biznes tanlash uchun) va aktiv biznes a'zolarini ko'radi.
CREATE POLICY business_members_select ON business_members FOR SELECT
  USING (business_id = app_business_id() OR user_id = app_user_id());
CREATE POLICY business_members_insert ON business_members FOR INSERT
  WITH CHECK (business_id = app_business_id());
CREATE POLICY business_members_update ON business_members FOR UPDATE
  USING (business_id = app_business_id()) WITH CHECK (business_id = app_business_id());

ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY invites_select ON invites FOR SELECT USING (business_id = app_business_id());
CREATE POLICY invites_insert ON invites FOR INSERT WITH CHECK (business_id = app_business_id());

-- ───────── Taklifni qabul qilish (ADR-0006 §5) ─────────
-- Foydalanuvchi hali a'zo emas, shuning uchun biznes konteksti yo'q: yagona atomik yo'l shu funksiya.
-- Yaroqsiz (topilmagan, muddati o'tgan, ishlatilgan) token uchun hech narsa qaytarmaydi.
-- Allaqachon ACTIVE a'zoni o'zgartirmaydi (rolni pasaytirmaydi); REVOKED bo'lsa qayta faollashtiradi.
CREATE FUNCTION redeem_invite(p_token_hash text, p_user_id uuid)
RETURNS TABLE (out_business_id uuid, out_role text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_invite invites%ROWTYPE;
BEGIN
  SELECT * INTO v_invite FROM invites i
  WHERE i.token_hash = p_token_hash AND i.used_at IS NULL AND i.expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  INSERT INTO business_members AS m (business_id, user_id, role, status)
  VALUES (v_invite.business_id, p_user_id, v_invite.role, 'ACTIVE')
  ON CONFLICT (business_id, user_id) DO UPDATE
    SET status = 'ACTIVE', revoked_at = NULL, role = EXCLUDED.role
    WHERE m.status = 'REVOKED';

  UPDATE invites SET used_by = p_user_id, used_at = now() WHERE id = v_invite.id;

  RETURN QUERY
    SELECT m.business_id, m.role FROM business_members m
    WHERE m.business_id = v_invite.business_id AND m.user_id = p_user_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION redeem_invite(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION redeem_invite(text, uuid) TO nasiya_app;
