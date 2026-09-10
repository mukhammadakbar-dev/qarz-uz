-- ============================================================
-- Migration 007 — take the dead payment link out of reminder templates
--
-- The default template ended in "To'lov: {link}", and the reminder sweep filled
-- {link} with {PUBLIC_BASE_URL}/pay/<token>. That URL is an API endpoint that
-- answers with JSON: there is no checkout page, and Click is not integrated yet
-- (subscriptions are renewed by hand — see 006). So every overdue reminder sent
-- a customer a link that opens a wall of JSON.
--
-- schema.sql now defaults to a template without {link}, but CREATE TABLE IF NOT
-- EXISTS never touches a table that already exists, so the default and the rows
-- already out there both have to be fixed here.
--
-- {link} itself stays supported in renderTemplate: once Click is live a shop can
-- put it back deliberately. This only removes it where nobody chose it.
-- ============================================================

ALTER TABLE reminder_settings
  ALTER COLUMN template
  SET DEFAULT 'Hurmatli {name}, {amount} so''m qarzingiz muddati {due} da tugaydi.';

-- Strip the placeholder plus the label that introduces it, so a message does not
-- trail off as "... da tugaydi. To'lov:" with nothing after the colon. Handles
-- the uz and ru defaults and any custom template that reused the same shape;
-- a bare {link} with no label is removed too.
UPDATE reminder_settings
SET template = btrim(
      regexp_replace(
        template,
        '[[:space:]]*(To''lov|To''lov havolasi|Оплата|Ссылка)?[[:space:]]*:?[[:space:]]*[{]link[}]',
        '',
        'g'
      )
    ),
    updated_at = now()
WHERE template LIKE '%{link}%';
