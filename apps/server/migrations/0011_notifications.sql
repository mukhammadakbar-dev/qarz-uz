-- 0011: obuna eslatmalari (ADR-0005 §Eslatmalar, T5.2).
--
-- Kalit: {business_id}:{kind}:{tugash_vaqti}. Bitta eslatma bir marta yuboriladi; obuna uzaytirilsa tugash
-- vaqti o'zgaradi va yangi muddat uchun eslatmalar qaytadan yuboriladi. Faqat nasiya_system yozadi.

CREATE TABLE notifications (
  key         text PRIMARY KEY CHECK (char_length(key) <= 200),
  business_id uuid NOT NULL REFERENCES businesses (id),
  kind        text NOT NULL CHECK (kind IN ('SUB_3D', 'SUB_1D', 'SUB_EXPIRED')),
  status      text NOT NULL DEFAULT 'SENT' CHECK (status IN ('SENT', 'BLOCKED')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_business_idx ON notifications (business_id, created_at DESC);

REVOKE ALL ON notifications FROM nasiya_app;
-- DELETE: vaqtinchalik xatoda da'vo qaytariladi va keyingi yurishda qayta urinadi
GRANT UPDATE, DELETE ON notifications TO nasiya_system;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
