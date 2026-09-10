import { z } from 'zod';
import { asyncHandler, NotFound } from '../utils/errors.js';
import { query } from '../db/pool.js';

/**
 * Platform announcements as the shop owner sees them.
 *
 * The admin's broadcast writes one `announcements` row and pushes it over
 * Telegram; this is the other half — the copy the web app reads, which is what
 * makes the message reliable for owners who have no Telegram linked (in
 * practice, most of them) and lets anyone find it again days later.
 */

// A handful of announcements is all the UI ever shows; the cap keeps a platform
// that has been broadcasting for years from shipping its whole history on every
// page load.
const MAX_ANNOUNCEMENTS = 30;

export const announcementSchemas = {
  idParam: z.object({ id: z.string().uuid() }),
};

/**
 * GET /api/shop/announcements
 * Recent announcements, newest first, each flagged with whether this user has
 * read it. `unreadCount` saves the client counting client-side and disagreeing.
 */
export const listAnnouncements = asyncHandler(async (req, res) => {
  const subRes = await query(
    `SELECT s.id AS shop_id, sub.plan, sub.status, sub.ends_at
     FROM shops s
     LEFT JOIN subscriptions sub ON sub.shop_id = s.id
     WHERE s.owner_id = $1`,
    [req.user.id]
  );
  const sub = subRes.rows[0] || {};
  const isExpired = sub.ends_at && new Date(sub.ends_at) <= new Date();
  const effectiveStatus = isExpired ? 'expired' : sub.status || 'trial';
  const planTarget = sub.plan ? `plan_${sub.plan}` : 'plan_start';

  const { rows } = await query(
    `SELECT a.id, a.body, a.target_type, a.created_at,
            (r.user_id IS NOT NULL) AS is_read
     FROM announcements a
     LEFT JOIN announcement_reads r
       ON r.announcement_id = a.id AND r.user_id = $1
     WHERE a.target_type = 'all'
        OR a.target_type = $2
        OR a.target_type = $3
     ORDER BY a.created_at DESC
     LIMIT ${MAX_ANNOUNCEMENTS}`,
    [req.user.id, effectiveStatus, planTarget]
  );

  res.json({
    announcements: rows,
    unreadCount: rows.filter((a) => !a.is_read).length,
  });
});

/**
 * POST /api/shop/announcements/:id/read
 *
 * Idempotent: the same announcement can be dismissed from the banner and the
 * bell, in two tabs, without producing a second row or an error — the composite
 * primary key turns the repeat into a no-op.
 */
export const markAnnouncementRead = asyncHandler(async (req, res) => {
  const exists = await query('SELECT 1 FROM announcements WHERE id = $1', [req.params.id]);
  if (!exists.rows[0]) throw NotFound('E\'lon topilmadi');

  await query(
    `INSERT INTO announcement_reads (announcement_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (announcement_id, user_id) DO NOTHING`,
    [req.params.id, req.user.id]
  );

  res.json({ ok: true });
});
