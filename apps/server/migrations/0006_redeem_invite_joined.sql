-- 0006: redeem_invite endi "yangi qo'shildimi" belgisini ham qaytaradi (egasiga xabar faqat haqiqiy
-- qo'shilishda yuborilishi uchun). Qaytariladigan tuzilma o'zgargani uchun funksiya qayta yaratiladi.

DROP FUNCTION redeem_invite(text, uuid);

CREATE FUNCTION redeem_invite(p_token_hash text, p_user_id uuid)
RETURNS TABLE (out_business_id uuid, out_role text, out_joined boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_invite invites%ROWTYPE;
  v_rows   integer;
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
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  UPDATE invites SET used_by = p_user_id, used_at = now() WHERE id = v_invite.id;

  RETURN QUERY
    SELECT m.business_id, m.role, v_rows > 0 FROM business_members m
    WHERE m.business_id = v_invite.business_id AND m.user_id = p_user_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION redeem_invite(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION redeem_invite(text, uuid) TO nasiya_app;
