import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { asyncHandler, AppError, NotFound } from '../utils/errors.js';
import { query } from '../db/pool.js';
import { normalizePhone } from '../utils/phone.js';
import { assertStaffQuota } from '../services/plan.service.js';

export const staffSchemas = {
  create: z.object({
    phone: z.string().min(7),
    password: z.string().min(6),
    fullName: z.string().min(1).optional(),
  }),
  setActive: z.object({
    active: z.boolean(),
  }),
};

/** POST /api/shop/staff — add a staff member to the owner's shop. */
export const createStaff = asyncHandler(async (req, res) => {
  const shopId = req.user.shopId;
  if (!shopId) throw new AppError('Do\'kon topilmadi', 400, 'NO_SHOP');

  const normPhone = normalizePhone(req.body.phone);
  if (!normPhone) throw new AppError('Telefon raqami noto\'g\'ri', 422, 'BAD_PHONE');

  await assertStaffQuota(shopId);

  const existing = await query('SELECT id FROM users WHERE phone = $1', [normPhone]);
  if (existing.rows[0]) {
    throw new AppError('Bu raqam allaqachon ro\'yxatdan o\'tgan', 409, 'PHONE_TAKEN');
  }

  const hash = await bcrypt.hash(req.body.password, 10);
  const { rows } = await query(
    `INSERT INTO users (role, phone, password_hash, full_name, parent_shop_id)
     VALUES ('staff', $1, $2, $3, $4)
     RETURNING id, phone, full_name, is_active, created_at`,
    [normPhone, hash, req.body.fullName || null, shopId]
  );

  res.status(201).json(rows[0]);
});

/** GET /api/shop/staff — list staff for the owner's shop. */
export const listStaff = asyncHandler(async (req, res) => {
  const shopId = req.user.shopId;
  const { rows } = await query(
    `SELECT id, phone, full_name, is_active, created_at
     FROM users
     WHERE parent_shop_id = $1 AND role = 'staff'
     ORDER BY created_at DESC`,
    [shopId]
  );
  res.json(rows);
});

/** PATCH /api/shop/staff/:id/active — block or re-enable a staff member. */
export const setStaffActive = asyncHandler(async (req, res) => {
  const shopId = req.user.shopId;
  const { rows } = await query(
    `UPDATE users SET is_active = $1, updated_at = now()
     WHERE id = $2 AND parent_shop_id = $3 AND role = 'staff'
     RETURNING id, phone, full_name, is_active`,
    [req.body.active, req.params.id, shopId]
  );
  if (!rows[0]) throw NotFound('Xodim topilmadi');
  res.json(rows[0]);
});

/** DELETE /api/shop/staff/:id — remove a staff member from this shop. */
export const deleteStaff = asyncHandler(async (req, res) => {
  const shopId = req.user.shopId;
  const { rows } = await query(
    `DELETE FROM users
     WHERE id = $1 AND parent_shop_id = $2 AND role = 'staff'
     RETURNING id`,
    [req.params.id, shopId]
  );
  if (!rows[0]) throw NotFound('Xodim topilmadi');
  res.json({ ok: true, deleted: rows[0].id });
});
